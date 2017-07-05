"use strict";

var onlyJS = false;
var detectCycles = true;
var filter = "";
var nameToCount = null;

var filters = [];

var framesSeen = new Set();

function processSample(thread, samples, index) {
    var numFrames = 9999999;
    if (filter.length > 0) {
        numFrames = 0;
        var stackIndex = samples.stack[index];
        var include = false;
        var i = 1;
        do {
            var frameIndex = thread.stackTable.frame[stackIndex];
            var funcIndex = thread.frameTable.func[frameIndex];
            var funcName = thread.stringArray[thread.funcTable.name[funcIndex]];
            if (funcName.includes(filter))
                numFrames = i;
            i++;
            stackIndex = thread.stackTable.prefix[stackIndex];
        } while (stackIndex !== null);    
        if (numFrames === 0)
            return false;
    }

    framesSeen.clear();

    var stackIndex = samples.stack[index];
    var isSelf = true;
    do {
        var frameIndex = thread.stackTable.frame[stackIndex];
        var funcIndex = thread.frameTable.func[frameIndex];

        var isJS = thread.funcTable.isJS[funcIndex];
        var funcName = thread.stringArray[thread.funcTable.name[funcIndex]];
        var key = funcIndex;

        var impl = null;
        if (isJS) {
            impl = thread.frameTable.implementation[frameIndex];
            if (impl !== null) {
                impl = thread.stringArray[impl];
            } else {
                impl = "interpreter";
            }
        }

        if ((isJS || !onlyJS) && (!detectCycles || !framesSeen.has(key))) {
            if (nameToCount.has(key)) {
                var entry = nameToCount.get(key);
                entry.totalCount += 1;
                entry.selfCount += (isSelf ? 1 : 0);
                if (impl) {
                    if (!(impl in entry.implementations))
                        throw "Unexpected implementation: " + impl;
                    entry.implementations[impl]++;
                }
            } else {
                var loc = thread.stringArray[thread.funcTable.fileName[funcIndex]] + ":" +
                    thread.funcTable.lineNumber[funcIndex];
                var implementations = null;
                if (isJS) {
                    implementations = {interpreter: 0, baseline: 0, ion: 0};
                    if (!(impl in implementations))
                        throw "Unexpected implementation: " + impl;
                    implementations[impl] = 1;
                }
                nameToCount.set(key, {totalCount: 1,
                                      selfCount: (isSelf ? 1 : 0),
                                      implementations: implementations,
                                      name: funcName,
                                      location: loc
                                     });
            }
            isSelf = false;
            framesSeen.add(key);
        }
        if (--numFrames === 0)
            break;

        stackIndex = thread.stackTable.prefix[stackIndex];
    } while (stackIndex !== null);

    return !isSelf;
}

function saveFilter() {
    if (filter !== document.getElementById("filter").value &&
        (filters.length === 0 || filters[filters.length - 1] !== filter))
    {
        filters.push(filter);
    }
}

function analyzeThread(thread) {
    clearFramesTable();

    nameToCount = new Map();
    onlyJS = document.getElementById("onlyjs").checked;
    var showAll = document.getElementById("showall").checked;
    filter = document.getElementById("filter").value;

    var prevFilterButton = document.getElementById("prevfilter");
    prevFilterButton.disabled = (filters.length === 0);
    prevFilterButton.onclick = function(event) {
        var filter = "";
        if (filters.length > 0)
            filter = filters.pop();
        document.getElementById("filter").value = filter;
        analyzeThread(thread);
        event.preventDefault();
    };

    var samples = thread.samples;
    var numSamples = 0;
    for (var i = 0; i < samples.length; i++) {
        if (processSample(thread, samples, i))
            numSamples++;
    }

    var arr = [];
    for (var [name, count] of nameToCount) {
        arr.push({name, count});
    }
    arr.sort(function(a, b) {
        if (a.count.totalCount === b.count.totalCount)
            return a.count.selfCount - b.count.selfCount;
        return a.count.totalCount - b.count.totalCount;
    });
    arr.reverse();

    var framesTable = document.getElementById("frames");
    framesTable.style.display = "";

    framesTable.innerHTML = `
      <tr>
        <th class="numheader">Total</th>
        <th class="numheader">Total %</th>
        <th class="numheader">Self</th>
        <th>Name</th>
        <th id="engine">interp/baseline/ion</th>
      </tr>`;

    var numRows = showAll ? arr.length : Math.min(3000, arr.length);

    for (var i = 0; i < numRows; i++) {
        var item = arr[i];
        var row = framesTable.insertRow(i + 1);
        var cell;

        cell = row.insertCell(0);
        var totalCount = item.count.totalCount;
        cell.textContent = totalCount;

        cell = row.insertCell(1);
        cell.textContent = (totalCount / numSamples * 100).toFixed(1) + "%";
        cell.style.textAlign = "right";

        cell = row.insertCell(2);
        cell.textContent = item.count.selfCount;

        cell = row.insertCell(3);
        cell.textContent = item.count.name;
        cell.style.cursor = "pointer";
        cell.onclick = function() {
            document.getElementById("filter").value = this.textContent;
            saveFilter();
            analyzeThread(thread);
        };

        if (item.count.implementations) {
            // Add filename:lineno tooltip if it's a JS frame.
            cell.title = item.count.location;
        }

        cell = row.insertCell(4);
        if (item.count.implementations) {
            var impl = item.count.implementations;
            cell.textContent = impl.interpreter + " / " + impl.baseline + " / " + impl.ion;
        }
    }

    var s = "";
    if (arr.length > numRows)
        s = (arr.length - numRows) + " rows hidden. Select 'Show All' to show everything (might be slow).";
    document.getElementById("rowshidden").textContent = s;
}

function clearFramesTable() {
    var framesTable = document.getElementById("frames");
    framesTable.style.display = "none";
    framesTable.innerHTML = "";
    document.getElementById("rowshidden").textContent = "";
}

function analyze(data) {
    var select = document.getElementById("thread");
    select.innerHTML = "";

    var opt = document.createElement("option");
    opt.value = -1;
    opt.innerHTML = "-- select a thread --";
    opt.selected = true;
    select.appendChild(opt);

    for (var i = 0; i < data.threads.length; i++) {
        var thread = data.threads[i];
        var name = thread.name + " (process: " + thread.processType + ", pid: " + thread.pid + ")";
        var opt = document.createElement("option");
        opt.value = i;
        opt.innerHTML = name;
        select.appendChild(opt);
    }

    clearFramesTable();

    saveFilter();

    var analyzeThisThread = () => analyzeThread(data.threads[select.value]);

    select.onchange = analyzeThisThread;
    document.getElementById("onlyjs").onchange = analyzeThisThread;
    document.getElementById("showall").onchange = analyzeThisThread;

    document.getElementById("filter").onchange = function() {
        saveFilter();
        analyzeThisThread();
    };
}

window.onload = function() {
    clearFramesTable();
    var button = document.getElementById("file");
    file.onchange = function(event) {
        const reader = new FileReader()
        reader.onload = (event) => {
            let text = event.target.result;
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                alert("Couldn't parse JSON");
            }
            analyze(data);
        };
        reader.readAsText(document.getElementById("file").files[0]);
        event.preventDefault();
    }
};
