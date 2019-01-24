/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

import React from "react";
import ReactDOM from "react-dom";
import * as Select from "cockpit-components-select.jsx";
import cockpit from "cockpit";
import { journal } from "journal";

const _ = cockpit.gettext;

let month_names = [
    _("month-name", 'January'),
    _("month-name", 'February'),
    _("month-name", 'March'),
    _("month-name", 'April'),
    _("month-name", 'May'),
    _("month-name", 'June'),
    _("month-name", 'July'),
    _("month-name", 'August'),
    _("month-name", 'September'),
    _("month-name", 'October'),
    _("month-name", 'November'),
    _("month-name", 'December')
];

function format_entry(journal_entry) {
    function pad(n) {
        var str = n.toFixed();
        if (str.length === 1)
            str = '0' + str;
        return str;
    }

    var d = new Date(journal_entry["__REALTIME_TIMESTAMP"] / 1000);
    return {
        cursor: journal_entry["__CURSOR"],
        full: journal_entry,
        day_single: d.getDate().toFixed(),
        day: month_names[d.getMonth()] + ' ' + d.getDate().toFixed() + ', ' + d.getFullYear().toFixed(),
        time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
        bootid: journal_entry["_BOOT_ID"],
        ident: journal_entry["SYSLOG_IDENTIFIER"] || journal_entry["_COMM"],
        prio: journal_entry["PRIORITY"],
        message: journal.printable(journal_entry["MESSAGE"])
    };
}

function DayHeader(props) {
    return (
        <div className="panel-heading">{props.day}</div>
    );
}

function RebootDivider(props) {
    return (
        <div className="cockpit-logline" role="row">
            <div className="cockpit-log-warning" role="cell" />
            <span className="cockpit-log-message cockpit-logmsg-reboot" role="cell">{_("Reboot")}</span>
        </div>
    );
}

function LoadMore(props) {
    return (
        <div className="journal-start" role="rowgroup">
            <button id="journal-load-earlier" className="btn btn-default" data-inline="true" data-mini="true" onClick={props.onClick}>
                {_("Load earlier entries")}
            </button>
        </div>
    );
}

function LogElement(props) {
    const entry = props.entry;

    let problem = false;
    let warning = false;

    let day_header = null;
    let reboot_header = null;

    if (entry.ident === 'abrt-notification') {
        problem = true;
        entry.ident = entry['PROBLEM_BINARY'];
    } else if (entry.prio < 4) {
        warning = true;
    }

    if (props.day) {
        day_header = (<DayHeader day={props.day} />);
    }

    if (props.reboot) {
        reboot_header = (<RebootDivider />);
    }

    return (
        <React.Fragment>
            {day_header}
            {reboot_header}
            <div className="cockpit-logline" role="row" key={entry.cursor}>
                <div className="cockpit-log-warning" role="cell">
                    { warning
                        ? <i className="fa fa-exclamation-triangle" />
                        : null
                    }
                    { problem
                        ? <i className="fa fa-times-circle-o" />
                        : null
                    }
                </div>
                <div className="cockpit-log-time" role="cell">{entry.time}</div>
                <span className="cockpit-log-message" role="cell">{entry.message}</span>
                {
                    props.count > 1
                        ? <div className="cockpit-log-service-container" role="cell">
                            <div className="cockpit-log-service-reduced" role="cell">{entry.ident}</div>
                            <span className="badge" role="cell">{props.count}&#160;<i className="fa fa-caret-right" /></span>
                        </div>
                        : <div className="cockpit-log-service" role="cell">{entry.ident}</div>
                }
            </div>
        </React.Fragment>
    );
}

class View extends React.Component {
    constructor(props) {
        super(props);
        this.changeCurrentDay = this.changeCurrentDay.bind(this);
        this.changeSeverity = this.changeSeverity.bind(this);
        this.journalStart = this.journalStart.bind(this);
        this.loadMore = this.loadMore.bind(this);
        this.journalctl = null;
        this.cursor = null;
        this.state = {
            prio: cockpit.location.options.prio || "3",
            current_day: cockpit.location.options.current_day || null,
            entries: []
        };
    }

    addEntries(entries) {
        this.setState({
            streamed: this.state.streamed + 1,
            entries: this.entries,
        });
    }

    loadMore() {
        this.cursor = this.state.entries.slice(-1)["__CURSOR"];
        this.journalStart();
    }

    journalStart() {
        if (this.journalctl) {
            this.journalctl.stop();
        }

        if (this.cursor === null) {
            this.setState({entries: []});
        }

        let matches = [];

        const prio = parseInt(this.state.prio);

        if (prio) {
            for (let i = 0; i <= prio; i++) {
                matches.push('PRIORITY=' + i.toString());
            }
        }

        if (prio === 2) {
            matches.push('SYSLOG_IDENTIFIER=abrt-notification');
        }

        let options = {
            follow: false,
            reverse: true,
        };

        if (this.state.current_day === 'boot') {
            options["boot"] = null;
        } else if (this.state.current_day === 'last_24h') {
            options["since"] = "-1days";
        } else if (this.state.current_day === 'last_week') {
            options["since"] = "-7days";
        }

        if (this.cursor) {
            options["after"] = this.cursor;
        }

        this.journalctl = journal.journalctl(matches, options);

        this.journalctl.stream((entries) => {
            this.setState((state) => {
                return {entries: state.entries.concat(entries)};
            });
        });
    }

    changeCurrentDay(target) {
        let options = cockpit.location.options;
        options.current_day = target;
        cockpit.location.go([], options);
        this.setState({current_day: target}, this.journalStart);
    }

    changeSeverity(target) {
        let options = cockpit.location.options;
        options.prio = target;
        cockpit.location.go([], options);
        this.setState({prio: target}, this.journalStart);
    }

    componentDidMount() {
        this.journalStart();
    }

    render() {
        const currentDayMenu = {
            recent: _("Recent"),
            boot: _("Current boot"),
            last_24h: _("Last 24 hours"),
            last_week: _("Last 7 days"),
        };

        const severityMenu = {
            '*': _("Everything"),
            '0': _("Only Emergency"),
            '1': _("Alert and above"),
            '2': _("Critical and above"),
            '3': _("Error and above"),
            '4': _("Warning and above"),
            '5': _("Notice and above"),
            '6': _("Info and above"),
            '7': _("Debug and above"),
        };

        const filter_menu = (
            <div className="content-header-extra">
                <Select.Select key="currentday" onChange={this.changeCurrentDay}
                               id="currentday" initial={this.state.current_day}>
                    <Select.SelectEntry data='recent' key='recent'>{currentDayMenu.recent}</Select.SelectEntry>
                    <Select.SelectEntry data='boot' key='boot'>{currentDayMenu.boot}</Select.SelectEntry>
                    <Select.SelectEntry data='last_24h' key='last_24h'>{currentDayMenu.last_24h}</Select.SelectEntry>
                    <Select.SelectEntry data='last_week' key='last_week'>{currentDayMenu.last_week}</Select.SelectEntry>
                </Select.Select>
                <label className="control-label" htmlFor="prio">{_("Severity")}</label>
                <Select.Select key="prio" onChange={this.changeSeverity}
                               id="prio" initial={this.state.prio}>
                    <Select.SelectEntry data='*' key='*'>{severityMenu['*']}</Select.SelectEntry>
                    <Select.SelectEntry data='0' key='0'>{severityMenu['0']}</Select.SelectEntry>
                    <Select.SelectEntry data='1' key='1'>{severityMenu['1']}</Select.SelectEntry>
                    <Select.SelectEntry data='2' key='2'>{severityMenu['2']}</Select.SelectEntry>
                    <Select.SelectEntry data='3' key='3'>{severityMenu['3']}</Select.SelectEntry>
                    <Select.SelectEntry data='4' key='4'>{severityMenu['4']}</Select.SelectEntry>
                    <Select.SelectEntry data='5' key='5'>{severityMenu['5']}</Select.SelectEntry>
                    <Select.SelectEntry data='6' key='6'>{severityMenu['6']}</Select.SelectEntry>
                    <Select.SelectEntry data='7' key='7'>{severityMenu['7']}</Select.SelectEntry>
                </Select.Select>

            </div>
        );

        const load_more = (<LoadMore onClick={this.loadMore} />);

        let count = 1;

        const entries =
            this.state.entries.length === 0 ? _("Loading...") : (
                this.state.entries.map((_entry, index, array) => {
                    const entry = format_entry(_entry);

                    if (index === 0) {
                        return (<LogElement key={entry.cursor} entry={entry} day={entry.day} />);
                    }

                    if ((index + 1) < array.length) {
                        let next_entry = format_entry(array[index + 1]);

                        if (entry.message === next_entry.message) {
                            count++;
                            return null;
                        }
                    }

                    if (count > 1) {
                        const count_prop = count;
                        count = 1;
                        return (<LogElement key={entry.cursor} entry={entry} count={count_prop} />);
                    }

                    let prev_entry = format_entry(array[index - 1]);

                    if (entry.day_single !== prev_entry.day_single && entry.bootid !== prev_entry.bootid) {
                        return (<LogElement key={entry.cursor} entry={entry} day={entry.day} reboot />);
                    } else if (entry.day_single !== prev_entry.day_single) {
                        return (<LogElement key={entry.cursor} entry={entry} day={entry.day} />);
                    } else if (entry.bootid !== prev_entry.bootid) {
                        return (<LogElement key={entry.cursor} entry={entry} reboot />);
                    } else {
                        return (<LogElement key={entry.cursor} entry={entry} />);
                    }
                })
            );

        return (
            <React.Fragment>
                {filter_menu}
                <div id="journal-box" className="container-fluid">
                    <div className="panel panel-default cockpit-log-panel" id="logs-view">
                        {entries}
                    </div>
                    { this.state.entries.length > 0 ? load_more : null }
                </div>
            </React.Fragment>
        );
    }
}

ReactDOM.render(<View />, document.getElementById('view'));
