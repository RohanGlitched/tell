// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell in VS Code: on open and on save, each .compact contract is compiled
// with the real Compact compiler and analysed; findings become diagnostics on
// the line that leaks, with the fix on hover and the grade in the status bar.

import path from 'node:path';
import * as vscode from 'vscode';
import { isContractFile, type ContractResult, type Severity } from '@tell/engine';
import { fixMarkdown, hoverMarkdown, statusOf, toDiagnostics, type PlainDiagnostic, type Span } from './mapping.js';
import { forgetCompilers, runTell } from './runner.js';

const isCompact = (d: vscode.TextDocument) => d.uri.scheme === 'file' && d.fileName.endsWith('.compact');
const SELECTOR: vscode.DocumentSelector = [{ scheme: 'file', pattern: '**/*.compact' }];
const FIX_SCHEME = 'tell-fix';

type Entry = { result: ContractResult; diags: PlainDiagnostic[] };

export function activate(ctx: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection('tell');
  const output = vscode.window.createOutputChannel('Tell');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'workbench.actions.view.problems';
  const entries = new Map<string, Entry>();
  const fixDocs = new Map<string, string>();
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();

  const cfg = () => vscode.workspace.getConfiguration('tell');
  const range = (s: Span) => new vscode.Range(s.line, s.start, s.line, s.end);

  const toVscode = (doc: vscode.TextDocument, d: PlainDiagnostic) => {
    const v = new vscode.Diagnostic(range(d.span), d.message, d.level as number as vscode.DiagnosticSeverity);
    v.source = d.source;
    v.code = { value: d.code, target: vscode.Uri.parse('https://tell-midnight.vercel.app/how') };
    v.relatedInformation = d.related.map((r) => new vscode.DiagnosticRelatedInformation(new vscode.Location(doc.uri, range(r.span)), r.message));
    return v;
  };

  const showStatus = () => {
    const ed = vscode.window.activeTextEditor;
    const doc = ed?.document;
    if (!doc || !isCompact(doc) || !cfg().get<boolean>('enable', true)) return status.hide();
    if (running.has(doc.uri.toString())) {
      status.text = '$(sync~spin) Tell';
      status.tooltip = 'Tell is compiling and analysing this contract';
      status.backgroundColor = undefined;
      return status.show();
    }
    const s = statusOf(entries.get(doc.uri.toString())?.result);
    if (!s) return status.hide();
    status.text = s.text;
    status.tooltip = s.tooltip;
    status.backgroundColor = s.tone === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground') : s.tone === 'warning' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    status.show();
  };

  async function scanOnce(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    if (!isContractFile(doc.getText())) {
      collection.delete(doc.uri);
      entries.delete(key);
      output.appendLine(`${doc.fileName}: a module or include file, not a contract; not scanned on its own.`);
      return;
    }
    const c = cfg();
    const t0 = Date.now();
    const result = await runTell(doc.fileName, {
      compilerVersion: c.get<string>('compilerVersion', ''),
      compilerDirs: c.get<string[]>('compilerDirs', []),
      cliPath: c.get<string>('cliPath', '') || undefined,
    }).catch((e: Error): ContractResult => ({ file: doc.fileName, compiler: null, language: null, ok: false, error: e.message }));
    const diags = toDiagnostics(result, doc.getText(), { minSeverity: c.get<Severity>('minSeverity', 'low') });
    entries.set(key, { result, diags });
    collection.set(doc.uri, diags.map((d) => toVscode(doc, d)));
    const name = path.basename(doc.fileName);
    if (result.ok) output.appendLine(`${name}: grade ${result.grade}, compact ${result.compiler}, ${diags.length} diagnostics (${Date.now() - t0} ms)`);
    else output.appendLine(`${name}: could not compile\n${result.error ?? ''}`);
  }

  // One scan per file at a time; a save during a scan queues one more.
  function scan(doc: vscode.TextDocument) {
    if (!isCompact(doc) || !cfg().get<boolean>('enable', true)) return;
    const key = doc.uri.toString();
    if (running.has(key)) {
      again.add(key);
      return;
    }
    const p = scanOnce(doc).finally(() => {
      running.delete(key);
      showStatus();
      if (again.delete(key)) scan(doc);
    });
    running.set(key, p);
    showStatus();
  }

  const findingAt = (uri: string, index: number) => entries.get(uri)?.diags[index];
  const indexOf = (uri: string, d: vscode.Diagnostic) => entries.get(uri)?.diags.findIndex((x) => x.span.line === d.range.start.line && x.message === d.message) ?? -1;

  async function showFix(arg?: { uri: string; index: number }) {
    let a = arg;
    if (!a) {
      // From the palette: the first finding on the cursor's line.
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const key = ed.document.uri.toString();
      const i = entries.get(key)?.diags.findIndex((d) => d.span.line === ed.selection.active.line) ?? -1;
      if (i < 0) return vscode.window.showInformationMessage('Tell has no finding on this line.');
      a = { uri: key, index: i };
    }
    const d = findingAt(a.uri, a.index);
    if (!d) return;
    const file = vscode.workspace.asRelativePath(vscode.Uri.parse(a.uri));
    const id = `${d.finding.kind}-${d.finding.circuit}-${d.finding.line ?? 0}`;
    fixDocs.set(id, fixMarkdown(d.finding, file, d.related.map((r) => r.message.replace(/^public transcript of [^:]+: /, ''))));
    const uri = vscode.Uri.from({ scheme: FIX_SCHEME, path: `/${id}.md` });
    try {
      await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    } catch {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }
  }

  ctx.subscriptions.push(
    collection,
    output,
    status,
    vscode.workspace.registerTextDocumentContentProvider(FIX_SCHEME, {
      provideTextDocumentContent: (uri) => fixDocs.get(uri.path.replace(/^\//, '').replace(/\.md$/, '')) ?? 'This finding is no longer reported.',
    }),
    vscode.commands.registerCommand('tell.scanFile', () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc && isCompact(doc)) scan(doc);
      else vscode.window.showInformationMessage('Open a .compact contract to scan it with Tell.');
    }),
    vscode.commands.registerCommand('tell.showFix', showFix),
    vscode.commands.registerCommand('tell.showOutput', () => output.show()),
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        const ds = (entries.get(doc.uri.toString())?.diags ?? []).map((d, i) => ({ d, i })).filter(({ d }) => d.span.line === pos.line);
        if (ds.length === 0) return;
        const md = new vscode.MarkdownString(
          hoverMarkdown(
            ds.map(({ d }) => d),
            (d) => `command:tell.showFix?${encodeURIComponent(JSON.stringify([{ uri: doc.uri.toString(), index: ds.find((x) => x.d === d)!.i }]))}`,
          ),
        );
        md.isTrusted = { enabledCommands: ['tell.showFix'] };
        return new vscode.Hover(md, range(ds[0].d.span));
      },
    }),
    vscode.languages.registerCodeActionsProvider(
      SELECTOR,
      {
        provideCodeActions(doc, _range, context) {
          return context.diagnostics
            .filter((d) => d.source === 'Tell')
            .map((d) => {
              const action = new vscode.CodeAction("Show Tell's fix", vscode.CodeActionKind.QuickFix);
              action.diagnostics = [d];
              action.command = { command: 'tell.showFix', title: "Show Tell's fix", arguments: [{ uri: doc.uri.toString(), index: indexOf(doc.uri.toString(), d) }] };
              return action;
            });
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.workspace.onDidOpenTextDocument((d) => cfg().get<boolean>('scanOnOpen', true) && scan(d)),
    vscode.workspace.onDidSaveTextDocument((d) => cfg().get<boolean>('scanOnSave', true) && scan(d)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      collection.delete(d.uri);
      entries.delete(d.uri.toString());
    }),
    vscode.window.onDidChangeActiveTextEditor(showStatus),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('tell')) return;
      forgetCompilers();
      if (!cfg().get<boolean>('enable', true)) {
        collection.clear();
        entries.clear();
      }
      for (const d of vscode.workspace.textDocuments) if (cfg().get<boolean>('scanOnOpen', true)) scan(d);
      showStatus();
    }),
  );

  if (cfg().get<boolean>('scanOnOpen', true)) for (const d of vscode.workspace.textDocuments) scan(d);
  showStatus();
}

export function deactivate() {}
