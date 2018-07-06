/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import sha1 from "js-sha1";
import stable_stringify from "json-stable-stringify";

import {
    dialog_open,
    SelectOneRadio, TextInput, PassInput, Intermission, CheckBox
} from "./dialogx.jsx";
import { decode_filename } from "./utils.js";
import { StorageButton } from "./storage-controls.jsx";

import * as python from "python.jsx";
import luksmeta_monitor_hack_py from "raw!./luksmeta-monitor-hack.py";
import clevis_luks_passphrase_sh from "raw!./clevis-luks-passphrase.sh";

const _ = cockpit.gettext;

/* Tang advertisement utilities
 */

function get_tang_adv(url) {
    return cockpit.spawn([ "curl", "-sSf", url + "/adv" ], { err: "message" })
            .then(JSON.parse)
            .catch(error => {
                return cockpit.reject(error.toString().replace(/^curl: \([0-9]+\) /, ""));
            });
}

function tang_adv_payload(adv) {
    return JSON.parse(cockpit.utf8_decoder().decode(cockpit.base64_decode(adv["payload"])));
}

function jwk_b64_encode(bytes) {
    // Use the urlsafe character set, and strip the padding.
    return cockpit.base64_encode(bytes).replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, '');
}

function compute_thp(jwk) {
    var REQUIRED_ATTRS = {
        'RSA': ['kty', 'p', 'd', 'q', 'dp', 'dq', 'qi', 'oth'],
        'EC':  ['kty', 'crv', 'x', 'y'],
        'oct': ['kty', 'k'],
    };

    var req = REQUIRED_ATTRS[jwk.kty];
    var norm = { };
    req.forEach(k => { if (k in jwk) norm[k] = jwk[k]; });
    return jwk_b64_encode(sha1.digest(stable_stringify(norm)));
}

function compute_sigkey_thps(adv) {
    function is_signing_key(jwk) {
        if (!jwk.use && !jwk.key_ops)
            return true;
        if (jwk.use == "sig")
            return true;
        if (jwk.key_ops && jwk.key_ops.indexOf("verify") >= 0)
            return true;
        return false;
    }

    return adv.keys.filter(is_signing_key).map(compute_thp);
}

/* Clevis operations
 */

function clevis_add(block, pin, cfg, passphrase) {
    // HACK - clevis 6 has only "bind luks", let's use that for now
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "clevis", "bind", "luks", "-f", "-k", "-", "-d", dev, pin, JSON.stringify(cfg) ],
                         { superuser: true, err: "message" }).input(passphrase);
}

function clevis_remove(block, key) {
    // HACK - only clevis version 10 brings "luks unbind"
    // cryptsetup needs a terminal on stdin, even with -q or --key-file.
    var script = 'cryptsetup luksKillSlot -q "$0" "$1" && luksmeta wipe -d "$0" -s "$1" -f';
    return cockpit.spawn([ "/bin/sh", "-c", script, decode_filename(block.Device), key.slot ],
                         { superuser: true, err: "message", pty: true });
}

function clevis_recover_passphrase(block) {
    var dev = decode_filename(block.Device);
    return cockpit.script(clevis_luks_passphrase_sh, [ dev ],
                          { superuser: true, err: "message" })
            .then(output => {
                return output.trim();
            });
}

/* Passphrase operations
 */

function passphrase_add(block, new_passphrase, old_passphrase) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksAddKey", dev ],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase);
}

function passphrase_change(block, key, new_passphrase, old_passphrase) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksChangeKey", dev, "--key-slot", key.slot.toString() ],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase + "\n");
}

function passphrase_remove(block, passphrase) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksRemoveKey", dev ],
                         { superuser: true, err: "message" }).input(passphrase);
}

/* Generic slot operations
 */

function slot_remove(block, slot) {
    var dev = decode_filename(block.Device);
    return cockpit.spawn([ "cryptsetup", "luksKillSlot", "-q", dev, slot.toString() ],
                         { superuser: true, err: "message", pty: true });
}

/* Dialogs
 */

function existing_passphrase_fields() {
    return [
        Intermission("In order to make changes to the keys, you need to provide an existing passphrase that can unlock the disk.",
                     { visible: vals => vals.needs_explicit_passphrase }),
        PassInput("passphrase", _("Existing passphrase"),
                  { visible: vals => vals.needs_explicit_passphrase,
                    validate: val => !val.length && _("Passphrase cannot be empty")
                  })
    ];
}

function get_existing_passphrase(dlg, block) {
    dlg.run(_("Trying to unlock disk for modifications"),
            clevis_recover_passphrase(block).then(passphrase => {
                if (passphrase == "") {
                    dlg.set_values({ needs_explicit_passphrase: true });
                } else {
                    dlg.set_values({ passphrase: passphrase });
                }
            })
    );
}

function add_dialog(client, block) {
    let dlg = dialog_open({ Title: _("Add key slot"),
                            Fields: [
                                SelectOneRadio("type", _("Slot type"),
                                               { value: "tang",
                                                 widest_title: _("Confirm new passphrase")
                                               },
                                               [ { value: "luks-passphrase", title: _("Passphrase") },
                                                   { value: "tang", title: _("Tang keyserver") }
                                               ]),
                                PassInput("new_passphrase", _("New passphrase"),
                                          { visible: vals => vals.type == "luks-passphrase",
                                            validate: val => !val.length && _("Passphrase cannot be empty")
                                          }),
                                PassInput("new_passphrase2", _("Confirm new passphrase"),
                                          { visible: vals => vals.type == "luks-passphrase",
                                            validate: (val, vals) => {
                                                return (vals.new_passphrase.length &&
                                                        vals.new_passphrase != val &&
                                                        _("Passphrases do not match"));
                                            }
                                          }),
                                TextInput("tang_url", _("Tang keyserver URL"),
                                          { visible: vals => vals.type == "tang",
                                            validate: val => !val.length && _("Tang URL cannot be empty")
                                          })
                            ].concat(existing_passphrase_fields()),
                            Action: {
                                Title: _("Add"),
                                action: function (vals) {
                                    if (vals.type == "luks-passphrase") {
                                        return passphrase_add(block, vals.new_passphrase, vals.passphrase);
                                    } else {
                                        return get_tang_adv(vals.tang_url).then(function (adv) {
                                            edit_tang_adv(client, block, null,
                                                          vals.tang_url, adv, vals.passphrase);
                                        });
                                    }
                                }
                            }
    });

    get_existing_passphrase(dlg, block);
}

function edit_passphrase_dialog(block, key) {
    dialog_open({ Title: _("Change passphrase"),
                  Fields: [
                      PassInput("old_passphrase", _("Old passphrase"),
                                { validate: val => !val.length && _("Passphrase cannot be empty")
                                }),
                      PassInput("new_passphrase", _("New passphrase"),
                                { validate: val => !val.length && _("Passphrase cannot be empty")
                                }),
                      PassInput("new_passphrase2", _("Confirm new passphrase"),
                                { validate: (val, vals) => vals.new_passphrase.length && vals.new_passphrase != val && _("Passphrases do not match")
                                })
                  ],
                  Action: {
                      Title: _("Apply"),
                      action: function (vals) {
                          return passphrase_change(block, key, vals.new_passphrase, vals.old_passphrase);
                      }
                  }
    });
}

function edit_clevis_dialog(client, block, key) {
    let dlg = dialog_open({ Title: _("Edit tang keyserver"),
                            Fields: [
                                TextInput("tang_url", _("Tang keyserver URL"),
                                          { validate: val => !val.length && _("Tang URL cannot be empty"),
                                            value: key.url
                                          })
                            ].concat(existing_passphrase_fields()),
                            Action: {
                                Title: _("Apply"),
                                action: function (vals) {
                                    return get_tang_adv(vals.tang_url).then(adv => {
                                        edit_tang_adv(client, block, key, vals.tang_url, adv, vals.passphrase);
                                    });
                                }
                            }
    });

    get_existing_passphrase(dlg, block);
}

class Revealer extends React.Component {
    render() {
        if (this.state.revealed)
            return <div>{this.props.children}</div>;
        else
            return (
                <a onClick={event => { if (event.button == 0) this.setState({ revealed: true }) }}>
                    {this.props.summary}
                </a>
            );
    }
}

function edit_tang_adv(client, block, key, url, adv, passphrase) {
    var port_pos = url.lastIndexOf(":");
    var host = (port_pos >= 0) ? url.substr(0, port_pos) : url;
    var port = (port_pos >= 0) ? url.substr(port_pos + 1) : "";
    var cmd = cockpit.format("ssh $0 tang-show-keys $1", host, port);
    var cmd_alt = cockpit.format("ssh $0 \"curl -s localhost:$1/adv |\n  jose fmt -j- -g payload -y -o- |\n  jose jwk use -i- -r -u verify -o- |\n  jose jwk thp -i-\"", host, port);

    var sigkey_thps = compute_sigkey_thps(tang_adv_payload(adv));

    dialog_open({ Title: _("Verify key"),
                  Body: (
                      <div>
                          <div>{_("Make sure the key hash from the Tang server matches:")}</div>
                          { sigkey_thps.map(s => <div className="sigkey-hash">{s}</div>) }
                          <br />
                          <div>{_("Manually check with SSH: ")}<pre className="inline-pre">{cmd}</pre></div>
                          <br />
                          <Revealer summary={_("What if tang-show-keys is not available?")}>
                              <p>{_("If tang-show-keys is not available, run the following:")}</p>
                              <pre>{cmd_alt}</pre>
                          </Revealer>
                      </div>
                  ),
                  Action: {
                      Title: _("Trust key"),
                      action: function () {
                          return clevis_add(block, "tang", { url: url, adv: adv }, passphrase).then(() => {
                              if (key)
                                  return clevis_remove(block, key);
                          });
                      }
                  }
    });
}

function remove_passphrase_dialog(block, key) {
    dialog_open({ Title: _("Remove passphrase"),
                  Fields: [
                      Intermission(_("Removing a passphrase might prevent future unlocking of the volume and might thus cause data loss.")),
                      PassInput("passphrase", _("Passphrase to remove"),
                                { validate: (val, vals) => !val.length && !vals.remove_slot && _("Passphrase cannot be empty")
                                }),
                      Intermission(_("If you don't recall the passphrase, you can still remove whatever passphrase is in this slot.  Be extra careful to verify that this is indeed what you want to do.")),
                      CheckBox("remove_slot", cockpit.format(_("Remove passphrase in slot $0"), key.slot), { })
                  ],
                  Action: {
                      DangerButton: true,
                      Title: _("Remove passphrase"),
                      action: function (vals) {
                          if (vals.remove_slot)
                              return slot_remove(block, key.slot);
                          else
                              return passphrase_remove(block, vals.passphrase);
                      }
                  }
    });
}

function remove_clevis_dialog(client, block, key) {
    dialog_open({ Title: cockpit.format(_("Please confirm removal of $0"), key.url),
                  Body: (
                      <div>
                          <p>{_("Removing a keyserver might prevent future unlocking of the volume and might thus cause data loss.")}</p>
                          <p>{_("Removing a keyserver might prevent unattended booting.")}</p>
                      </div>
                  ),
                  Action: {
                      DangerButton: true,
                      Title: _("Remove keyserver"),
                      action: function () {
                          return clevis_remove(block, key);
                      }
                  }
    });
}

export class CryptoKeyslots extends React.Component {
    constructor() {
        super();
        this.state = { version: 1, slots: null, slot_error: null, max_slots: 8 };
    }

    monitor_slots(block) {
        // HACK - we only need this until UDisks2 has a Encrypted.Slots property or similar.
        if (block != this.monitored_block) {
            if (this.monitored_block)
                this.monitor_channel.close();
            this.monitored_block = block;
            if (block) {
                var dev = decode_filename(block.Device);
                this.monitor_channel = python.spawn(luksmeta_monitor_hack_py, [ dev ],
                                                    { superuser: true });
                var buf = "";
                this.monitor_channel.stream(output => {
                    var lines;
                    buf += output;
                    lines = buf.split("\n");
                    buf = lines[lines.length - 1];
                    if (lines.length >= 2) {
                        const data = JSON.parse(lines[lines.length - 2]);
                        this.setState({ slots: data.slots, version: data.version });
                    }
                });
                this.monitor_channel.fail(err => {
                    this.setState({ slots: [ ], slot_error: err });
                })
            }
        }
    }

    componentDidUmount() {
        this.monitor_slots(null);
    }

    render() {
        var client = this.props.client;
        var block = this.props.block;

        if (!client.features.clevis)
            return null;

        this.monitor_slots(block);

        if (this.state.version > 1 || (this.state.slots == null && this.state.slot_error == null))
            return null;

        function decode_clevis_slot(slot) {
            if (slot.ClevisConfig) {
                var clevis = JSON.parse(slot.ClevisConfig.v);
                if (clevis.pin && clevis.pin == "tang" && clevis.tang) {
                    return { slot: slot.Index.v,
                             type: "tang",
                             url: clevis.tang.url
                    };
                } else {
                    return { slot: slot.Index.v,
                             type: "unknown",
                             pin: clevis.pin
                    };
                }
            } else {
                return { slot: slot.Index.v,
                         type: "luks-passphrase"
                };
            }
        }

        var keys = this.state.slots.map(decode_clevis_slot).filter(k => !!k);

        function key_description(key) {
            if (key.type == "tang")
                return key.url;
            else
                return cockpit.format(_("Unknown slot type '$0'"), key.pin);
        }

        var rows;
        if (keys.length == 0) {
            var text;
            if (this.state.slot_error) {
                if (this.state.slot_error.problem == "access-denied")
                    text = _("The currently logged in user is not permitted to see information about keys.");
                else
                    text = this.state.slot_error.toString();
            } else {
                text = _("No key slots");
            }
            rows = <tr><td className="text-center">{text}</td></tr>;
        } else {
            rows = [ ];

            var add_row = (slot, desc, edit, edit_excuse, remove) => {
                rows.push(
                    <tr>
                        <td>{slot}</td>
                        <td>{desc}</td>
                        <td className="text-right">
                            <StorageButton onClick={edit}
                                           excuse={(keys.length == this.state.max_slots)
                                               ? _("Editing a key requires a free slot")
                                               : null}>
                                <span className="pficon pficon-edit" />
                            </StorageButton>
                            { "\n" }
                            <StorageButton onClick={remove}
                                           excuse={keys.length == 1 ? _("The last key slot can not be removed") : null}>
                                <span className="fa fa-minus" />
                            </StorageButton>
                        </td>
                    </tr>
                );
            }

            keys.sort((a, b) => a.slot - b.slot).forEach(key => {
                if (key.type == "luks-passphrase") {
                    add_row(key.slot, _("Passphrase"),
                            () => edit_passphrase_dialog(block, key), null,
                            () => remove_passphrase_dialog(block, key));
                } else {
                    add_row(key.slot, key_description(key),
                            () => edit_clevis_dialog(client, block, key),
                            key.type == "unknown" ? _("Key slots with unknown types can not be edited here") : null,
                            () => remove_clevis_dialog(client, block, key))
                }
            });
        }

        return (
            <div className="panel panel-default key-slot-panel">
                <div className="panel-heading">
                    <div className="pull-right">
                        <span className="key-slot-panel-n-out-of-m">
                            {cockpit.format(_("$0 of $1 slots"), rows.length, this.state.max_slots)}
                        </span>
                        { "\n" }
                        <StorageButton onClick={() => add_dialog(client, block)}
                                       excuse={(keys.length == this.state.max_slots)
                                           ? _("No free key slots")
                                           : null}>
                            <span className="fa fa-plus" />
                        </StorageButton>
                    </div>
                    {_("Key slots")}
                </div>
                <table className="table">
                    <tbody> { rows } </tbody>
                </table>
            </div>
        );
    }
}
