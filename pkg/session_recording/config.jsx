/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

(function() {
    "use strict";

    // let $ = require("jquery");
    let cockpit = require("cockpit");
    // let _ = cockpit.gettext;
    let React = require("react");

    let json = require('comment-json');

    let ini = require('ini');

    let Config = class extends React.Component {
        constructor(props) {
            super(props);
            this.handleInputChange = this.handleInputChange.bind(this);
            this.handleSubmit = this.handleSubmit.bind(this);
            this.setConfig = this.setConfig.bind(this);
            this.prepareConfig = this.prepareConfig.bind(this);
            this.file = null;
            this.state = {
                config: {
                    shell: "/bin/bash",
                    notice: "\\nATTENTION! Your session is being recorded!\\n\\n",
                    latency: "10",
                },
            }
        }
        /*
            payload
            log
                input
                output
                window
            limit
                rate
                burst
                action
            file
                path
            syslog
                facility
                priority
            journal
                priority
                augment
            writer
                journal
         */

        handleInputChange(e){
            const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
            const name = e.target.name;
            const config = this.state.config;
            config[name] = value;

            this.forceUpdate();
        }

        prepareConfig() {
            this.state.config.latency = parseInt(this.state.config.latency);
        }

        handleSubmit() {
            this.prepareConfig();
            this.file.replace(this.state.config).done( function() {
                console.log('updated');
            })
                .fail( function(error) {
                    console.log(error);
                });
            event.preventDefault();
        }

        setConfig(data) {
            this.setState({config: data});
        }

        componentDidMount() {
            let parseFunc = function(data) {
                // console.log(data);
                // return data;
                return json.parse(data, null, true);
            };

            let stringifyFunc = function(data) {
                return json.stringify(data, null, true);
            };
            // needed for cockpit.file usage
            let syntax_object = {
                parse: parseFunc,
                stringify: stringifyFunc,
            };

            this.file = cockpit.file("/etc/tlog/tlog-rec-session.conf", {
                syntax: syntax_object,
                // binary: boolean,
                // max_read_size: int,
                superuser: true,
                // host: string
            });

            let promise = this.file.read();

            promise.done(this.setConfig);

            promise.fail(function(error) {
                console.log(error);
            });
        }

        render() {
            if (this.state.config != null) {
                return (
                    <form onSubmit={this.handleSubmit}>
                    <table className="info-table-ct col-md-12">
                        <tbody>
                            <tr>
                                <td><label htmlFor="shell">Shell</label></td>
                                <td>
                                    <input type="text" id="shell" name="shell" value={this.state.config.shell}
                                           className="form-control" onChange={this.handleInputChange} />
                                </td>
                            </tr>
                            <tr>
                                <td><label htmlFor="notice">Notice</label></td>
                                <td>
                                    <input type="text" id="notice" name="notice" value={this.state.config.notice}
                                           className="form-control" onChange={this.handleInputChange} />
                                </td>
                            </tr>
                            <tr>
                                <td><label htmlFor="latency">Latency</label></td>
                                <td>
                                    <input type="text" id="latency" name="latency" value={this.state.config.latency}
                                           className="form-control" onChange={this.handleInputChange} />
                                </td>
                            </tr>
                            <tr>
                                <td>

                                </td>
                                <td>
                                    <button className="btn btn-default" type="submit">Save</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    </form>
                );
            } else {
                return (<div></div>);
            }
        }
    };

    let SssdConfig = class extends React.Component {
        constructor(props) {
            super(props);
            this.handleSubmit = this.handleSubmit.bind(this);
            this.handleInputChange = this.handleInputChange.bind(this);
            this.setConfig = this.setConfig.bind(this);
            this.file = null;
            this.state = {
                config: {
                    session_recording: {
                        scope: null,
                        users: null,
                        groups: null,
                    },
                },
            };
        }

        handleInputChange(e){
            const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
            const name = e.target.name;
            const config = this.state.config;
            config.session_recording[name] = value;

            this.forceUpdate();
        }

        setConfig(data) {
            this.setState({config: data});
        }

        componentDidMount() {
            let syntax_object = {
                parse:     ini.parse,
                stringify: ini.stringify
            };

            this.file = cockpit.file("/etc/sssd/conf.d/sssd-session-recording.conf", {
                syntax: syntax_object,
                superuser: true,
            });

            let promise = this.file.read();

            promise.done(this.setConfig);

            promise.fail(function(error) {
                console.log(error);
            });
        }

        handleSubmit() {
            this.file.replace(this.state.config).done( function() {
                console.log('updated');
            })
            .fail( function(error) {
                console.log(error);
            });
            event.preventDefault();
        }

        render() {
            return (
                <form onSubmit={this.handleSubmit}>
                    <table className="info-table-ct col-md-12">
                        <tbody>
                        <tr>
                            <td><label htmlFor="scope">Scope</label></td>
                            <td>
                                <select name="scope" id="scope" className="form-control"
                                    value={this.state.config.session_recording.scope}
                                        onChange={this.handleInputChange} >
                                    <option value="none">None</option>
                                    <option value="some">Some</option>
                                    <option value="all">All</option>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <td><label htmlFor="users">Users</label></td>
                            <td>
                                <input type="text" id="users" name="users"
                                       value={this.state.config.session_recording.users}
                                       className="form-control" />
                            </td>
                        </tr>
                        <tr>
                            <td><label htmlFor="groups">Groups</label></td>
                            <td>
                                <input type="text" id="groups" name="groups"
                                       value={this.state.config.session_recording.groups}
                                       className="form-control" onChange={this.handleInputChange} />
                            </td>
                        </tr>
                        <tr>
                            <td>

                            </td>
                            <td>
                                <button className="btn btn-default" type="submit">Save</button>
                            </td>
                        </tr>
                        </tbody>
                    </table>
                </form>
            );
        }
    };
    React.render(<Config />, document.getElementById('sr_config'));
    React.render(<SssdConfig />, document.getElementById('sssd_config'));
}());
