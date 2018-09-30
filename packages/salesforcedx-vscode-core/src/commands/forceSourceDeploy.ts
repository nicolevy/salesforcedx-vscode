/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { CliCommandExecutor, Command, DeployError, ForceDeployErrorParser, SfdxCommandBuilder } from '@salesforce/salesforcedx-utils-vscode/out/src/cli';
import { ContinueResponse } from '@salesforce/salesforcedx-utils-vscode/out/src/types';
import * as path from 'path';
import * as vscode from 'vscode';
import { nls } from '../messages';
import { SfdxCommandlet, SfdxCommandletExecutor, SfdxWorkspaceChecker } from './commands';
import { FileType, ManifestOrSourcePathGatherer, SelectedPath } from './forceSourceRetrieve';

// move this elsewhere?
vscode.workspace.onDidChangeTextDocument((e => {
  if (ForceSourceDeployExecutor.errorCollection.has(e.document.uri)) {
    ForceSourceDeployExecutor.errorCollection.delete(e.document.uri);
  }
}));

export class ForceSourceDeployExecutor extends SfdxCommandletExecutor<SelectedPath> {

  public static errorCollection = vscode.languages.createDiagnosticCollection('deploy-errors');

  public build(data: SelectedPath): Command {
    const commandBuilder = new SfdxCommandBuilder()
      .withDescription(nls.localize('force_source_deploy_text'))
      .withArg('force:source:deploy')
      .withLogName('force_source_deploy')
      .withJson();
    if (data.type === FileType.Manifest) {
      commandBuilder.withFlag('--manifest', data.filePath);
    } else {
      commandBuilder.withFlag('--sourcepath', data.filePath);
    }
    return commandBuilder.build();
  }

  public execute(response: ContinueResponse<SelectedPath>): void {
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const cancellationToken = cancellationTokenSource.token;
    const workspacePath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.path : '';

    const execution = new CliCommandExecutor(this.build(response.data), {
      cwd: workspacePath
    }).execute(cancellationToken);

    let stdErr = '';
    execution.stderrSubject.subscribe(realData => {
      stdErr += realData.toString();
    });

    execution.processExitSubject.subscribe(async exitCode => {
      if (exitCode !== 0) {
        try {
          const parser = new ForceDeployErrorParser();
          const fileErrors = parser.parse(stdErr);
          Object.keys(fileErrors).forEach(filePath => {
            const uri = vscode.Uri.file(path.join(workspacePath, filePath));
            const fileDiagnostics: vscode.Diagnostic[] = [];
            fileErrors[filePath].forEach(err => {
              fileDiagnostics.push(this.createDiagnosticFromResult(err));
            });
            ForceSourceDeployExecutor.errorCollection.set(uri, fileDiagnostics);
          });
        } catch (e) {
          // something else happened...?
          console.log(`Could not parse Compile Errors`);
        }
      }
    });

    this.attachExecution(execution, cancellationTokenSource, cancellationToken);
    this.logMetric(execution.command.logName);
  }

  private createDiagnosticFromResult(err: DeployError) {
    const ln = Number(err.lineNumber) - 1;
    const col = Number(err.columnNumber) - 1;
    const range = new vscode.Range(new vscode.Position(ln, col), new vscode.Position(ln, col));
    return new vscode.Diagnostic(range, err.error, vscode.DiagnosticSeverity.Error);
  }
}

const workspaceChecker = new SfdxWorkspaceChecker();

export async function forceSourceDeploy(explorerPath: any) {
  const commandlet = new SfdxCommandlet(
    workspaceChecker,
    new ManifestOrSourcePathGatherer(explorerPath),
    new ForceSourceDeployExecutor()
  );
  await commandlet.run();
}
