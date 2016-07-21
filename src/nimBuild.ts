/*---------------------------------------------------------
 * Copyright (C) Xored Software Inc. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import os = require('os');
import fs = require('fs');
import { getNimExecPath, getProjectFile, getProjects, isProjectMode } from './nimUtils'
import { getNormalizedWorkspacePath } from './nimIndexer';

export interface ICheckResult {
    file: string;
    line: number;
    column: number;
    msg: string;
    severity: string;
}

function nimExec(command: string, args: string[], useStdErr: boolean, printToOutput: boolean, callback: (string) => any) {
    return new Promise((resolve, reject) => {
        if (!getNimExecPath()) {
            return resolve([]);
        }
        var cwd = vscode.workspace.rootPath;
        cp.execFile(getNimExecPath(), [command, ...args], { cwd: cwd }, (err, stdout, stderr) => {
            try {
                if (err && (<any>err).code == "ENOENT") {
                    vscode.window.showInformationMessage("No 'nim' binary could be found in PATH: '" + process.env["PATH"] + "'");
                    return resolve([]);
                }
                var out = (useStdErr ? stderr : stdout).toString();
                var ret = callback(out.split(os.EOL));
                if (err && printToOutput) {
                    var outputWindow = vscode.window.createOutputChannel("Nim Output");
                    outputWindow.append(stderr.toString());
                    outputWindow.append(stdout.toString());
                    outputWindow.show();
                }
                resolve(ret);
            } catch (e) {
                reject(e);
            }
        });
    });
}

function parseErrors(lines: string[]): ICheckResult[] {
    var ret: ICheckResult[] = [];
    var templateError: boolean = false; 
    var messageText = "";
    var lastFile = {file: null, column: null, line: null};
    for (var i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line.startsWith("Hint:")) {
            continue;
        }
        var match = /^([^(]*)?\((\d+)(,\s(\d+))?\)( (\w+):)? (.*)/.exec(line);
        if (!match) {
            if (messageText.length < 1024) {
                messageText += os.EOL + line;
            }
        } else { 
            var [_, file, lineStr, _, charStr, _, severity, msg] = match;
            if (msg === "template/generic instantiation from here") {
                let f = getNormalizedWorkspacePath(file);
                if (f.startsWith(vscode.workspace.rootPath)) {
                   lastFile = {file: f, column: charStr, line: lineStr};
                }
            } else {
                let f = getNormalizedWorkspacePath(file);
                if (f.startsWith(vscode.workspace.rootPath)) {
                    ret.push({ file: getNormalizedWorkspacePath(file), line: parseInt(lineStr), column: parseInt(charStr), msg: msg + os.EOL + messageText, severity });
                } else if (lastFile.file != null) {
                    ret.push({ file: lastFile.file, line: parseInt(lastFile.line), column: parseInt(lastFile.column), msg: msg + os.EOL + messageText, severity });
                }
                messageText = "";
                lastFile = {file: null, column: null, line: null};
            }
        }
    }
    return ret;
}

export function check(filename: string, nimConfig: vscode.WorkspaceConfiguration): Promise<ICheckResult[]> {
    var runningToolsPromises = [];
    var cwd = path.dirname(filename);

    if (!!nimConfig['lintOnSave']) {
        if (!isProjectMode()) {
            runningToolsPromises.push(nimExec("check", ['--listFullPaths', getProjectFile(filename)], true, false, parseErrors));
        } else {
            getProjects().forEach(project => {
                runningToolsPromises.push(nimExec("check", ['--listFullPaths', project], true, false, parseErrors));
            });
        }
    }

    return Promise.all(runningToolsPromises).then(resultSets => [].concat.apply([], resultSets));
}
