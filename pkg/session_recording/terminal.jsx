/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

    var React = require("react");
    var Term = require("term");
    let $ = require("jquery");

    require("console.css");
    require("jquery-resizable");
    require("jquery-resizable/resizable.css");

    /*
     * A terminal component that communicates over a cockpit channel.
     *
     * The only required property is 'channel', which must point to a cockpit
     * stream channel.
     *
     * The size of the terminal can be set with the 'rows' and 'cols'
     * properties. If those properties are not given, the terminal will fill
     * its container.
     *
     * If the 'onTitleChanged' callback property is set, it will be called whenever
     * the title of the terminal changes.
     *
     * Call focus() to set the input focus on the terminal.
     */
    var Terminal = React.createClass({
        propTypes: {
            cols: React.PropTypes.number,
            rows: React.PropTypes.number,
            channel: React.PropTypes.object.isRequired,
            onTitleChanged: React.PropTypes.func
        },

        componentWillMount: function () {
            var term = new Term({
                cols: this.state.cols || 80,
                rows: this.state.rows || 25,
                screenKeys: true,
                useStyle: true
            });

            term.on('data', function(data) {
                if (this.props.channel.valid)
                    this.props.channel.send(data);
            }.bind(this));

            if (this.props.onTitleChanged)
                term.on('title', this.props.onTitleChanged);

            this.setState({ terminal: term });
        },

        componentDidMount: function () {
            this.state.terminal.open(this.refs.terminal);
            this.connectChannel();

            let term = this.refs.terminal;
            let onWindowResize = this.onWindowResize;

            $( function() { $(term).resizable({
                direction: ['right', 'bottom'],
                stop: function() {
                    onWindowResize();
                },
            }); });

            if (!this.props.rows) {
                window.addEventListener('resize', this.onWindowResize);
                this.onWindowResize();
            }
        },

        componentWillUpdate: function (nextProps, nextState) {
            if (nextState.cols !== this.state.cols || nextState.rows !== this.state.rows) {
                this.state.terminal.resize(nextState.cols, nextState.rows);
                this.props.channel.control({
                    window: {
                        rows: nextState.rows,
                        cols: nextState.cols
                    }
                });
            }

            if (nextProps.channel !== this.props.channel) {
                this.state.terminal.reset();
                this.disconnectChannel();
            }
        },

        componentDidUpdate: function (prevProps) {
            if (prevProps.channel !== this.props.channel)
                this.connectChannel();
        },

        render: function () {
            let style = {
                'min-width': '300px',
                'min-height': '100px',
            }
            // ensure react never reuses this div by keying it with the terminal widget
            return <div ref="terminal" style={style} className="console-ct" key={this.state.terminal} />;
        },

        componentWillUnmount: function () {
            this.disconnectChannel();
            this.state.terminal.destroy();
        },

        onChannelMessage: function (event, data) {
            if (this.state.terminal) {
                this.state.terminal.write(data);
            }
        },

        onChannelClose: function (event, options) {
            var term = this.state.terminal;
            term.write('\x1b[31m' + (options.problem || 'disconnected') + '\x1b[m\r\n');
            term.cursorHidden = true;
            term.refresh(term.y, term.y);
        },

        connectChannel: function () {
            var channel = this.props.channel;
            if (channel && channel.valid) {
                channel.addEventListener('message', this.onChannelMessage.bind(this));
                channel.addEventListener('close', this.onChannelClose.bind(this));
            }
        },

        disconnectChannel: function () {
            if (this.props.channel) {
                this.props.channel.removeEventListener('message', this.onChannelMessage);
                this.props.channel.removeEventListener('close', this.onChannelClose);
            }
        },

        focus: function () {
            if (this.state.terminal)
                this.state.terminal.focus();
        },

        onWindowResize: function () {
            if (this.refs) {
                var padding = 2 * 11;
                var node = this.getDOMNode();
                var terminal = this.refs.terminal.querySelector('.terminal');

                var ch = document.createElement('div');
                ch.textContent = 'M';
                terminal.appendChild(ch);
                var height = ch.offsetHeight; // offsetHeight is only correct for block elements
                ch.style.display = 'inline';
                var width = ch.offsetWidth;
                terminal.removeChild(ch);

                this.setState({
                    rows: Math.floor((node.parentElement.clientHeight - padding) / height),
                    cols: Math.floor((node.parentElement.clientWidth - padding) / width)
                });
            }
            return;
        },

        send: function(value) {
            this.state.terminal.send(value);
        }
    });

    module.exports = { Terminal: Terminal };
}());
