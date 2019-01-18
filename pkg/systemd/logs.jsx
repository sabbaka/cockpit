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
import $ from "jquery";
import cockpit from "cockpit";
import { journal } from "journal";

const _ = cockpit.gettext;

$(function() {
    cockpit.translate();
    const _ = cockpit.gettext;

    var problems_client = cockpit.dbus('org.freedesktop.problems', { superuser: "try" });
    var service = problems_client.proxy('org.freedesktop.Problems2', '/org/freedesktop/Problems2');
    var problems = problems_client.proxies('org.freedesktop.Problems2.Entry', '/org/freedesktop/Problems2/Entry');

    // A map of ABRT's problems items and it's callback for rendering
    var problem_render_callbacks = {'core_backtrace': render_backtrace,
                                    'os_info': render_table_eq,
                                    'environ': render_table_eq,
                                    'limits': render_limits,
                                    'cgroup': render_cgroup,
                                    'namespaces': render_table_co,
                                    'maps': render_maps,
                                    'dso_list': render_dso_list,
                                    'mountinfo': render_mountinfo,
                                    'proc_pid_status': render_table_co,
                                    'open_fds': render_open_fds,
                                    'var_log_messages': render_multiline,
                                    'not-reportable': render_multiline,
                                    'exploitable': render_multiline,
                                    'suspend_stats': render_table_co,
                                    'dmesg': render_multiline,
                                    'container_rootfs': render_multiline,
                                    'docker_inspect': render_multiline
    };

    var problem_info_1 = ['reason', 'cmdline', 'executable', 'package', 'component',
        'crash_function', 'pid', 'pwd', 'hostname', 'count',
        'type', 'analyzer', 'rootdir', 'duphash', 'exception_type',
        'container', 'container_uuid', 'container_cmdline',
        'container_id', 'container_image' ];

    var problem_info_2 = ['Directory', 'username', 'abrt_version', 'architecture', 'global_pid', 'kernel',
        'last_occurrence', 'os_release', 'pkg_fingerprint', 'pkg_vendor',
        'runlevel', 'tid', 'time', 'uid', 'uuid'];

    var displayable_problems = {};

    // Get list of all problems that can be displayed
    var find_problems = function () {
        var r = $.Deferred();
        problems.wait(function() {
            try {
                service.GetProblems(0, {})
                        .done(function(problem_paths, options) {
                            update_problems(problem_paths);
                            r.resolve();
                        });
            } catch (err) {
                // ABRT is not installed. Suggest installing?
                r.resolve();
            }
        });
        return r;
    };

    function update_problems(problem_paths) {
        for (var i in problem_paths) {
            var p = problems[problem_paths[i]];
            displayable_problems[p.ID] = {'count': p.Count, 'problem_path': p.path};
            displayable_problems[p.UUID] = {'count': p.Count, 'problem_path': p.path};
            displayable_problems[p.Duphash] = {'count': p.Count, 'problem_path': p.path};
        }
    }

    /* Not public API */
    function journalbox(outer, start, match, day_box) {
        var box = $('<div class="panel panel-default cockpit-log-panel" role="table">');
        var start_box = $('<div class="journal-start" role="rowgroup">');

        outer.empty().append(box, start_box);

        var query_count = 5000;
        var query_more = 1000;

        var renderer = journal.renderer(box);
        /* cache to store offsets for days */
        var renderitems_day_cache = null;
        var procs = [];

        function query_error(error) {
            /* TODO: blank slate */
            console.warn(cockpit.message(error));
        }

        function prepend_entries(entries) {
            for (var i = 0; i < entries.length; i++)
                renderer.prepend(entries[i]);
            renderer.prepend_flush();
            /* empty cache for day offsets */
            renderitems_day_cache = null;
        }

        function append_entries(entries) {
            for (var i = 0; i < entries.length; i++)
                renderer.append(entries[i]);
            renderer.append_flush();
            /* empty cache for day offsets */
            renderitems_day_cache = null;
        }

        function didnt_reach_start(first) {
            var button = $('<button id="journal-load-earlier" class="btn btn-default" data-inline="true" data-mini="true">' +
                           _("Load earlier entries") +
                           '</button>');
            start_box.html(button);
            button.click(function() {
                var count = 0;
                var stopped = null;
                start_box.text(_("Loading..."));
                procs.push(journal.journalctl(match, { follow: false, reverse: true, cursor: first })
                        .fail(query_error)
                        .stream(function(entries) {
                            if (entries[0]["__CURSOR"] == first)
                                entries.shift();
                            count += entries.length;
                            append_entries(entries);
                            if (count >= query_more) {
                                stopped = entries[entries.length - 1]["__CURSOR"];
                                didnt_reach_start(stopped);
                                this.stop();
                            }
                        })
                        .done(function() {
                            if (start_box.text() == _("Loading..."))
                                start_box.empty();
                        }));
            });
        }

        function follow(cursor) {
            procs.push(journal.journalctl(match, { follow: true, count: 0, cursor: cursor })
                    .fail(query_error)
                    .stream(function(entries) {
                        if (entries[0]["__CURSOR"] == cursor)
                            entries.shift();
                        prepend_entries(entries);
                        update_day_box();
                    }));
        }

        function update_day_box() {
            /* Build cache if empty
             */
            if (renderitems_day_cache === null) {
                renderitems_day_cache = [];
                for (var d = box[0].firstChild; d; d = d.nextSibling) {
                    if ($(d).hasClass('panel-heading'))
                        renderitems_day_cache.push([$(d).offset().top, $(d).text()]);
                }
            }
            if (renderitems_day_cache.length > 0) {
                /* Find the last day that begins above top
                 */
                var currentIndex = 0;
                var top = window.scrollY;
                while ((currentIndex + 1) < renderitems_day_cache.length &&
                        renderitems_day_cache[currentIndex + 1][0] < top) {
                    currentIndex++;
                }
                day_box.text(renderitems_day_cache[currentIndex][1]);
            } else {
                /* No visible day headers
                 */
                day_box.text(_("Go to"));
            }
        }

        start_box.text(_("Loading..."));

        $(window).on('scroll', update_day_box);

        var options = {
            follow: false,
            reverse: true
        };

        var all = false;
        if (start == 'boot') {
            options["boot"] = null;
        } else if (start == 'last-24h') {
            options["since"] = "-1days";
        } else if (start == 'last-week') {
            options["since"] = "-7days";
        } else {
            all = true;
        }

        var last = null;
        var count = 0;
        var stopped = null;

        procs.push(journal.journalctl(match, options)
                .fail(query_error)
                .stream(function(entries) {
                    if (!last) {
                        last = entries[0]["__CURSOR"];
                        follow(last);
                        update_day_box();
                    }
                    count += entries.length;
                    append_entries(entries);
                    if (count >= query_count) {
                        stopped = entries[entries.length - 1]["__CURSOR"];
                        didnt_reach_start(stopped);
                        this.stop();
                    }
                })
                .done(function() {
                    if (start_box.text() == _("Loading..."))
                        start_box.empty();
                    if (!last) {
                        procs.push(journal.journalctl(match, { follow: true, count: 0,
                                                               boot: options["boot"],
                                                               since: options["since"]
                        })
                                .fail(query_error)
                                .stream(function(entries) {
                                    prepend_entries(entries);
                                    update_day_box();
                                }));
                    }
                    if (!all || stopped)
                        didnt_reach_start();
                }));

        outer.stop = function stop() {
            $(window).off('scroll', update_day_box);
            $.each(procs, function(i, proc) {
                proc.stop();
            });
        };

        return outer;
    }

    var filler;

    function stop_query() {
        if (filler)
            filler.stop();
    }

    function update_query() {
        stop_query();

        var match = [ ];

        var query_prio = cockpit.location.options['prio'] || "3";
        var prio_level = parseInt(query_prio, 10);

        // Set selected item into priority dropdown menu
        var all_prios = document.getElementById('prio-lists').childNodes;
        var item;
        for (var j = 0; j < all_prios.length; j++) {
            if (all_prios[j].nodeName === 'LI') {
                item = all_prios[j].childNodes[0];
                if (item.getAttribute('data-prio') === query_prio) {
                    $('#journal-prio').text(item.text);
                    break;
                }
            }
        }

        if (prio_level) {
            for (var i = 0; i <= prio_level; i++)
                match.push('PRIORITY=' + i.toString());
        }

        // If item 'Only Problems' was selected, match only ABRT's problems
        if (prio_level === 2) {
            match.push('SYSLOG_IDENTIFIER=abrt-notification');
        }

        var options = cockpit.location.options;
        if (options['service'])
            match.push('_SYSTEMD_UNIT=' + options['service']);
        else if (options['tag'])
            match.push('SYSLOG_IDENTIFIER=' + options['tag']);

        var query_start = cockpit.location.options['start'] || "recent";
        if (query_start == 'recent')
            $(window).scrollTop($(document).height());

        journalbox($("#journal-box"), query_start, match, $('#journal-current-day'));
    }

    function update_entry() {
        var cursor = cockpit.location.path[0];
        var out = $('#journal-entry-fields');

        out.empty();

        function show_entry(entry) {
            var d = new Date(entry["__REALTIME_TIMESTAMP"] / 1000);
            $('#journal-entry-date').text(d.toString());

            var id;
            if (entry["SYSLOG_IDENTIFIER"])
                id = entry["SYSLOG_IDENTIFIER"];
            else if (entry["_SYSTEMD_UNIT"])
                id = entry["_SYSTEMD_UNIT"];
            else
                id = _("Journal entry");

            var is_problem = false;
            if (id === 'abrt-notification') {
                is_problem = true;
                id = entry['PROBLEM_BINARY'];
            }

            $('#journal-entry-id').text(id);

            if (is_problem) {
                find_problems().done(function() {
                    create_problem(out, entry);
                });
            } else {
                create_entry(out, entry);
            }
        }

        function show_error(error) {
            out.append(
                $('<tr>').append(
                    $('<td>')
                            .text(error)));
        }

        journal.journalctl({ cursor: cursor, count: 1, follow: false })
                .done(function (entries) {
                    if (entries.length >= 1 && entries[0]["__CURSOR"] == cursor)
                        show_entry(entries[0]);
                    else
                        show_error(_("Journal entry not found"));
                })
                .fail(function (error) {
                    show_error(error);
                });
    }

    function create_entry(out, entry) {
        $('#journal-entry-message').text(journal.printable(entry['MESSAGE']));
        var keys = Object.keys(entry).sort();
        $.each(keys, function (i, key) {
            if (key !== 'MESSAGE') {
                out.append(
                    $('<tr>').append(
                        $('<td>').css('text-align', 'right')
                                .text(key),
                        $('<td>').css('text-align', 'left')
                                .text(journal.printable(entry[key]))));
            }
        });
    }

    function create_problem(out, entry) {
        var problem = null;
        var all_p = [entry['PROBLEM_DIR'], entry['PROBLEM_DUPHASH'], entry['PROBLEM_UUID']];
        for (var i = 0; i < all_p.length; i++) {
            if (all_p[i] in displayable_problems) {
                problem = problems[displayable_problems[all_p[i]]['problem_path']];
                break;
            }
        }

        // Display unknown problems as standard logs
        // unknown problem = deleted problem | problem of different user
        if (problem === null) {
            create_entry(out, entry);
            return;
        }

        function switch_tab(new_tab, new_content) {
            out.find('li').removeClass('active');
            new_tab.addClass('active');
            out.find('tbody.tab').first()
                    .replaceWith(new_content);
        }

        $('#journal-entry-message').text('');

        var ge_t = $('<li class="active">').append($('<a>').append($('<span translatable="yes">').text(_("General"))));
        var pi_t = $('<li>').append($('<a>').append($('<span translatable="yes">').text(_("Problem info"))));
        var pd_t = $('<li>').append($('<a>').append($('<span translatable="yes">').text(_("Problem details"))));

        var ge = $('<tbody>').addClass('tab');
        var pi = $('<tbody>').addClass('tab');
        var pd = $('<tbody>').addClass('tab')
                .append(
                    $('<tr>').append($('<div class="panel-group" id="accordion-markup">')));

        var tab = $('<ul class="nav nav-tabs nav-tabs-pf">');

        var d_btn = $('<button class="btn btn-danger problem-btn btn-delete pficon pficon-delete">');
        var r_btn = $();
        if (problem.IsReported) {
            for (var pid = 0; pid < problem.Reports.length; pid++) {
                if (problem.Reports[pid][0] === 'ABRT Server') {
                    var url = problem.Reports[pid][1]['URL']['v']['v'];
                    r_btn = $('<a class="problem-btn">')
                            .attr('href', url)
                            .attr("target", "_blank")
                            .text(_("Reported"));
                    break;
                }
            }
        } else if (problem.CanBeReported) {
            r_btn = $('<button class="btn btn-primary problem-btn">').text(_("Report"));

            r_btn.click(function() {
                tab.children(':last-child').replaceWith($('<div class="spinner problem-btn">'));
                var proc = cockpit.spawn(['reporter-ureport', '-d', problem.ID], { superuser: 'true' });
                proc.done(function() {
                    window.location.reload();
                });
                proc.fail(function(ex) {
                    var message;
                    // 70 is 'This problem has already been reported'
                    if (ex.exit_status === 70) {
                        window.location.reload();
                        return;
                    } else if (ex.problem === 'access-denied') {
                        message = _("Not authorized to upload-report");
                    } else if (ex.problem === "not-found") {
                        message = _("Reporter 'reporter-ureport' not found.");
                    } else {
                        message = _("Reporting was unsucessful. Try running `reporter-ureport -d " + problem.ID + "`");
                    }
                    $('<div class="alert alert-danger">')
                            .append('<span class="pficon pficon-error-circle-o">')
                            .text(message)
                            .insertAfter(".breadcrumb");
                    tab.children(':last-child').replaceWith($('<span>'));
                });
            });
        }

        ge_t.click(function() {
            switch_tab(ge_t, ge);
        });

        pi_t.click(function() {
            switch_tab(pi_t, pi);
        });

        pd_t.click(function() {
            switch_tab(pd_t, pd);
        });

        d_btn.click(function() {
            service.DeleteProblems([problem.path]);
            displayable_problems = { };
            find_problems().done(function() {
                cockpit.location.go('/');
            });
        });

        // write into general tab non-ABRT related items
        var keys = Object.keys(entry).sort();
        $.each(keys, function(i, key) {
            if (key !== 'MESSAGE' && key.indexOf('PROBLEM_') !== 0) {
                ge.append(
                    $('<tr>').append(
                        $('<td>').css('text-align', 'right')
                                .text(key),
                        $('<td>').css('text-align', 'left')
                                .text(journal.printable(entry[key]))));
            }
        });

        tab.html(ge_t);
        tab.append(pi_t);
        tab.append(pd_t);
        tab.append(d_btn);
        tab.append(r_btn);

        var header = $('<tr>').append(
            $('<th colspan=2>').append(tab));

        out.html(header).append(ge);
        out.css("margin-bottom", "0px");
        create_problem_details(problem, pi, pd);
    }

    function create_problem_details(problem, pi, pd) {
        service.GetProblemData(problem.path).done(function(args, options) {
            var i, elem, val;
            // Render first column of problem info
            var c1 = $('<table>').css('display', 'inline-block')
                    .css('padding-right', '200px')
                    .css('vertical-align', 'top')
                    .addClass('info-table-ct');
            pi.append(c1);
            for (i = 0; i < problem_info_1.length; i++) {
                elem = problem_info_1[i];
                if (elem in args) {
                    val = args[elem][2];
                    c1.append(
                        $('<tr>').append(
                            $('<td>').css('text-align', 'right')
                                    .text(elem),
                            $('<td>').css('text-align', 'left')
                                    .text(String(val))));
                }
            }

            // Render second column of problem info
            var c2 = $('<table>').css('display', 'inline-block')
                    .css('vertical-align', 'top')
                    .addClass('info-table-ct');
            pi.append(c2);
            for (i = 0; i < problem_info_2.length; i++) {
                elem = problem_info_2[i];
                if (elem in args) {
                    val = args[elem][2];
                    // Display date properly
                    if (['last_occurrence', 'time'].indexOf(elem) !== -1) {
                        var d = new Date(val / 1000);
                        val = d.toString();
                    }
                    c2.append(
                        $('<tr>').append(
                            $('<td>').css('text-align', 'right')
                                    .text(elem),
                            $('<td>').css('text-align', 'left')
                                    .text(String(val))));
                }
            }

            // Render problem details
            var problem_details_elems = Object.keys(problem_render_callbacks);
            $.each(problem_details_elems, function(i, key) {
                if (key in args) {
                    val = problem_render_callbacks[key](args[key]);
                    $('.panel-group', pd).append(
                        $('<div class="panel panel-default">')
                                .css("border-width", "0px 0px 2px 0px")
                                .css("margin-bottom", "0px")
                                .append(
                                    $('<div class="panel-heading problem-panel">')
                                            .attr('data-toggle', 'collapse')
                                            .attr('data-target', '#' + key)
                                            .attr('data-parent', '#accordion-markup')
                                            .append($('<h4 class="panel-title">')
                                                    .append($('<a class="accordion-toggle">')
                                                            .text(key))),
                                    $('<div class="panel-collapse collapse">')
                                            .attr('id', key)
                                            .append(
                                                $('<div class="panel-body">')
                                                        .html(val))));
                }
            });
        });
    }

    function render_table_eq(orig) {
        return render_table(orig, '=');
    }

    function render_table_co(orig) {
        return render_table(orig, ':');
    }

    function render_table(orig, delimiter) {
        var lines = orig[2].split('\n');
        var result = '<table class="detail_table">';

        for (var i = 0; i < lines.length - 1; i++) {
            var line = lines[i].split(delimiter);
            result += '<tr> <td class="text-right">' + line[0];
            result += '<td class="text-left">' + line[1];
            result += '</tr>';
        }

        result += '</table>';
        return result;
    }

    function render_multiline(orig) {
        var rendered = orig[2].replace(/\n/g, '<br>');
        return rendered;
    }

    function render_multitable(orig, delimiter) {
        var rendered = orig.replace(RegExp(delimiter, 'g'), '</td><td>');
        rendered = rendered.replace(/\n/g, '</td></tr><tr><td>');
        return '<table class="detail_table"><tr><td>' + rendered + '</td></tr></table>';
    }

    function render_dso_list(orig) {
        var rendered = orig[2].replace(/^(\S+\s+)(\S+)(.*)$/gm, '$1<b>$2</b>$3');
        return render_multitable(rendered, ' ');
    }

    function render_open_fds(orig) {
        var lines = orig[2].split('\n');
        for (var i = 0; i < lines.length - 1; i++) {
            if (i % 5 !== 0) {
                lines[i] = ':' + lines[i];
            }
        }
        return render_multitable(lines.join('\n'), ':');
    }

    function render_cgroup(orig) {
        return render_multitable(orig[2], ':');
    }

    function render_mountinfo(orig) {
        return render_multitable(orig[2].replace(/  +/g, ':'), ' ');
    }

    function render_maps(orig) {
        return render_multitable(orig[2].replace(/  +/g, ':'), ' ');
    }

    function render_limits(orig) {
        var lines = orig[2].split('\n');
        lines[0] = '":' + lines[0].replace(/(\S+) (\S+) /g, '$1:$2 ');
        for (var i = 1; i < lines.length - 1; i++) {
            lines[i] = lines[i].replace(/  +/g, ':');
        }

        return render_multitable(lines.join('\n'), ':');
    }

    function render_backtrace(content) {
        var content_json = JSON.parse(content[2]);

        var crash_thread = null;
        var other_threads = [];
        var other_items = {};

        for (var item in content_json) {
            if (item === 'stacktrace') {
                var threads = content_json[item];
                for (var thread_key in threads) {
                    var thread = threads[thread_key];

                    if (thread.hasOwnProperty("crash_thread") && thread['crash_thread']) {
                        if (thread.hasOwnProperty('frames')) {
                            crash_thread = thread['frames'];
                        }
                    } else {
                        if (thread.hasOwnProperty('frames')) {
                            other_threads.push(thread['frames']);
                        }
                    }
                }
            } else {
                other_items[item] = content_json[item];
            }
        }
        return create_detail_from_parsed_core_backtrace(crash_thread, other_threads, other_items);
    }

    function create_detail_from_parsed_core_backtrace(crash_thread, other_threads, other_items) {
        var detail_content = '';
        for (var item in other_items) {
            detail_content += item;
            detail_content += ': ' + other_items[item] + "  ";
        }

        detail_content += create_table_from_thread(crash_thread);

        if (other_threads.length !== 0) {
            detail_content += '<div id="other_threads_btn_div"><button class="btn btn-default other-threads-btn" title="">Show all threads</button></div>';
            detail_content += '<div class="hidden other_threads">';

            var thread_num = 1;
            for (var thread_key in other_threads) {
                detail_content += '\n';
                detail_content += 'thread: ' + thread_num++ + '\n';
                detail_content += create_table_from_thread(other_threads[thread_key]);
            }
            detail_content += '</div>';
        }

        return detail_content;
    }

    function create_table_from_thread(thread) {
        var all_keys = get_all_keys_from_frames(thread);

        /* create table legend */
        var table = '<table class="detail_table"><thead><tr><th>Fr #</th>';
        for (var key in all_keys) {
            table += '<th>';
            table += all_keys[key].replace(/_/g, ' ');
            table += '</th>';
        }
        table += '</tr></thead><tbody>';

        var frame_num = 1;
        for (var frame_key in thread) {
            table += '<tr>';
            table += '<td>';
            table += frame_num++;
            table += '</td>';

            var frame = thread[frame_key];
            for (var key_key in all_keys) {
                key = all_keys[key_key];

                var title = '';
                var row_content = '';
                if (key in frame) {
                    row_content = frame[key].toString();
                    if (row_content.length > 8)
                        title = row_content;
                } else
                    row_content = '';

                table += '<td title="' + title + '">';
                table += row_content;
                table += '</td>';
            }
            table += '</tr>';
        }

        table += '</tbody></table>';
        return table;
    }

    function get_all_keys_from_frames(thread) {
        var all_keys = [];

        for (var frame_key in thread) {
            var frame = thread[frame_key];
            var keys = Object.keys(frame);

            for (var key in keys) {
                if (all_keys.indexOf(keys[key]) === -1)
                    all_keys.push(keys[key]);
            }
        }

        /* order keys */
        var desired_ordered_of_keys = ['function_name', 'file_name', 'address', 'build_id', 'build_id_offset'];

        var all_ordered_keys = [];

        for (var key_key in desired_ordered_of_keys) {
            var in_key = desired_ordered_of_keys[key_key];
            var key_index = all_keys.indexOf(in_key);
            if (key_index !== -1) {
                all_ordered_keys.push(in_key);
                delete all_keys[key_index];
            }
        }

        for (key_key in all_keys) {
            all_ordered_keys.push(all_keys[key_key]);
        }

        return all_ordered_keys;
    }

    function update() {
        var path = cockpit.location.path;
        if (path.length === 0) {
            $("#journal-entry").hide();
            update_query();
            $("#journal").show();
        } else if (path.length == 1) {
            stop_query();
            $("#journal").hide();
            update_entry();
            $("#journal-entry").show();
        } else { /* redirect */
            console.warn("not a journal location: " + path);
            cockpit.location = '';
        }
        $("body").show();
    }

    $(cockpit).on("locationchanged", update);

    $('#journal-current-day-menu a').on('click', function() {
        cockpit.location.go([], $.extend(cockpit.location.options, { start: $(this).attr("data-op") }));
    });

    $('#journal-box').on('click', '.cockpit-logline', function() {
        var cursor = $(this).attr('data-cursor');
        if (cursor)
            cockpit.location.go([ cursor ], {'parent_options': JSON.stringify(cockpit.location.options)});
    });

    $('#journal-prio-menu a').on('click', function() {
        cockpit.location.go([], $.extend(cockpit.location.options, { prio: $(this).attr('data-prio') }));
    });

    $('#journal-navigate-home').on("click", function() {
        var parent_options;
        if (cockpit.location.options.parent_options) {
            parent_options = JSON.parse(cockpit.location.options.parent_options);
        }
        cockpit.location.go('/', parent_options);
    });

    update();
});

class View extends React.Component {
    constructor(props) {
        super(props);
        this.changeCurrentDay = this.changeCurrentDay.bind(this);
        this.changeSeverity = this.changeSeverity.bind(this);
        this.journalStart = this.journalStart.bind(this);
        this.journalctl = null;
        this.state = {
            entries: [],
            current_day: null,
            start: null,
            severity: 'everything',
            entry: null,
        };
    }

    journalStart() {
        let matches = [];
        let options = {
            follow: false,
            reverse: true,
            count: 100,
        };

        if (this.state.start === 'boot') {
            options["boot"] = null;
        } else if (this.state.start === 'last-24h') {
            options["since"] = "-1days";
        } else if (this.state.start === 'last-week') {
            options["since"] = "-7days";
        }

        this.journalctl = journal.journalctl(matches, options);

        this.journalctl.stream((entries) => {
            console.log(entries);
            this.setState({entries: this.state.entries.concat(entries)});
        }).fail((ex) => {
            console.log(ex);
        });
    }

    changeCurrentDay(target) {
        this.setState({ start: target });
        this.setState({ current_day: target });
    }

    changeSeverity(target) {
        this.setState({ severity: target });
    }

    componentDidMount() {
        /* TODO use state for options
                var all = false;
                if (start == 'boot') {
                    options["boot"] = null;
                } else if (start == 'last-24h') {
                    options["since"] = "-1days";
                } else if (start == 'last-week') {
                    options["since"] = "-7days";
                } else {
                    all = true;
                }

                if (prio_level) {
                    for (var i = 0; i <= prio_level; i++)
                        match.push('PRIORITY=' + i.toString());
                }

                if (prio_level === 2) {
                    match.push('SYSLOG_IDENTIFIER=abrt-notification');
                }
         */

        this.journalStart();
    }

    render() {
        let currentDayMenu = {
            recent: _("Recent"),
            boot: _("Current boot"),
            last_24h: _("Last 24 hours"),
            last_week: _("Last 7 days"),
        };

        let severityMenu = {
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

        let header = (
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
                               id="prio" initial={this.state.severity}>
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

        if (!this.state.entry) {
            return (
                <React.Fragment>
                    {header}
                    <LogsView entries={this.state.entries} />
                </React.Fragment>
            );
        } else {
            return (
                <React.Fragment>
                    {header}
                    <JournalEntry />
                </React.Fragment>
            );
        }
    }
}

class JournalEntry extends React.Component {
    render() {
        return (
            <div id="journal-entry" className="container-fluid">
                <ol className="breadcrumb">
                    <li><a id="journal-navigate-home" translatable="yes">Logs</a></li>
                    <li className="active" translatable="yes">Entry</li>
                </ol>
                <div className="panel panel-default">
                    <div className="panel-heading">
                        <span id="journal-entry-id">%ID%</span>
                        <span id="journal-entry-date" className="pull-right">%DATE%</span>
                    </div>
                    <div id="journal-entry-message">%MESSAGE%</div>
                    <table className="info-table-ct" id="journal-entry-fields">
                        %FIELDS%
                    </table>
                </div>
            </div>
        );
    }
}

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
        if (str.length == 1)
            str = '0' + str;
        return str;
    }

    var d = new Date(journal_entry["__REALTIME_TIMESTAMP"] / 1000);
    return {
        cursor: journal_entry["__CURSOR"],
        full: journal_entry,
        day: month_names[d.getMonth()] + ' ' + d.getDate().toFixed() + ', ' + d.getFullYear().toFixed(),
        time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
        bootid: journal_entry["_BOOT_ID"],
        ident: journal_entry["SYSLOG_IDENTIFIER"] || journal_entry["_COMM"],
        prio: journal_entry["PRIORITY"],
        message: journal.printable(journal_entry["MESSAGE"])
    };
}

function LogElement(props) {
    const entry = format_entry(props.entry);

    let problem = false;
    let warning = false;

    // TODO make actual count
    let count = 1;

    if (entry.ident === 'abrt-notification') {
        problem = true;
        entry.ident = entry['PROBLEM_BINARY'];
    } else if (entry.prio < 4) {
        warning = true;
    }

    return (
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
                count > 1
                    ? <div className="cockpit-log-service-container" role="cell">
                        <div className="cockpit-log-service-reduced" role="cell">{entry.ident}</div>
                        <span className="badge" role="cell">{count}&#160;<i className="fa fa-caret-right" /></span>
                    </div>
                    : <div className="cockpit-log-service" role="cell">{entry.ident}</div>
            }
        </div>
    );
}

function LogsView(props) {
    const entries = props.entries;
    const rows = entries.map((entry) =>
        <LogElement key={entry.__CURSOR} entry={entry} />
    );
    return (
        <div className="panel panel-default cockpit-log-panel" id="logs-view">
            {rows}
        </div>
    );
}

ReactDOM.render(<View />, document.getElementById('view'));
