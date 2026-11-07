// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The packaged bundle (dist/extension.cjs) activated against a small stand-in for
// the VS Code API: it scans an open contract, publishes diagnostics, sets the
// status bar grade, and answers hovers and code actions. Not a substitute for
// running VS Code; it checks the bundle loads and the wiring is right.
// Needs `npm run build -w vscode` and an installed compiler; skipped otherwise.

import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findCompilers } from '@tell/engine';

const BUNDLE = path.resolve(__dirname, '../dist/extension.cjs');
const CONTRACT = path.resolve(__dirname, '../../zoo/contracts/ballot-leaky.compact');
const hasCompiler = (await findCompilers()).length > 0;

class Range {
  constructor(public sl: number, public sc: number, public el: number, public ec: number) {}
  get start() {
    return { line: this.sl, character: this.sc };
  }
}
class Diagnostic {
  source?: string;
  code?: unknown;
  relatedInformation?: unknown[];
  constructor(public range: Range, public message: string, public severity: number) {}
}

function stub() {
  const disposable = { dispose() {} };
  const published = new Map<string, Diagnostic[]>();
  const commands = new Map<string, (...a: unknown[]) => unknown>();
  const providers: { hover?: { provideHover: Function }; actions?: { provideCodeActions: Function } } = {};
  const status = { text: '', tooltip: '', backgroundColor: undefined as unknown, command: '', visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} };
  const text = fs.readFileSync(CONTRACT, 'utf8');
  const uri = { scheme: 'file', fsPath: CONTRACT, path: CONTRACT, toString: () => `file://${CONTRACT}` };
  const doc = { uri, fileName: CONTRACT, getText: () => text };
  const vscode = {
    Range,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DiagnosticRelatedInformation: class { constructor(public location: unknown, public message: string) {} },
    Location: class { constructor(public uri: unknown, public range: Range) {} },
    ThemeColor: class { constructor(public id: string) {} },
    MarkdownString: class { isTrusted?: unknown; constructor(public value: string) {} },
    Hover: class { constructor(public contents: { value: string }, public range: Range) {} },
    CodeAction: class { diagnostics?: unknown[]; command?: { arguments: unknown[] }; constructor(public title: string, public kind: string) {} },
    CodeActionKind: { QuickFix: 'quickfix' },
    StatusBarAlignment: { Left: 1 },
    ViewColumn: { Beside: -2 },
    Uri: { parse: (s: string) => ({ toString: () => s }), from: (o: { path: string }) => o },
    languages: {
      createDiagnosticCollection: () => ({ set: (u: { toString(): string }, d: Diagnostic[]) => published.set(u.toString(), d), delete() {}, clear() {}, dispose() {} }),
      registerHoverProvider: (_s: unknown, p: { provideHover: Function }) => ((providers.hover = p), disposable),
      registerCodeActionsProvider: (_s: unknown, p: { provideCodeActions: Function }) => ((providers.actions = p), disposable),
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      createStatusBarItem: () => status,
      activeTextEditor: { document: doc, selection: { active: { line: 0 } } },
      onDidChangeActiveTextEditor: () => disposable,
      showInformationMessage() {},
    },
    workspace: {
      textDocuments: [doc],
      getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
      registerTextDocumentContentProvider: () => disposable,
      onDidOpenTextDocument: () => disposable,
      onDidSaveTextDocument: () => disposable,
      onDidCloseTextDocument: () => disposable,
      onDidChangeConfiguration: () => disposable,
      asRelativePath: (u: unknown) => String(u),
    },
    commands: { registerCommand: (id: string, f: (...a: unknown[]) => unknown) => ((commands.set(id, f), disposable)), executeCommand: async () => {} },
  };
  return { vscode, published, commands, providers, status, doc, uri, text };
}

describe.skipIf(!fs.existsSync(BUNDLE) || !hasCompiler)('the packaged bundle', () => {
  it('activates, scans the open contract, and wires diagnostics, status, hover and quick fix', async () => {
    const s = stub();
    const load = (Module as unknown as { _load: Function })._load;
    (Module as unknown as { _load: Function })._load = function (req: string, ...rest: unknown[]) {
      return req === 'vscode' ? s.vscode : load.call(this, req, ...rest);
    };
    try {
      const ext = createRequire(import.meta.url)(BUNDLE);
      const ctx = { subscriptions: [] as unknown[] };
      ext.activate(ctx);
      expect(ctx.subscriptions.length).toBeGreaterThan(5);
      expect([...s.commands.keys()].sort()).toEqual(['tell.scanFile', 'tell.showFix', 'tell.showOutput']);
      for (let i = 0; i < 600 && !s.published.has(s.uri.toString()); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 50));
      const diags = s.published.get(s.uri.toString())!;
      const errors = diags.filter((d) => d.severity === 0);
      expect(errors).toHaveLength(1);
      expect(errors[0].source).toBe('Tell');
      expect(errors[0].range.sl).toBe(s.text.split('\n').findIndex((l) => l.includes('ballots.insert(tag')));
      expect(errors[0].message).toContain('(2 bits)');
      expect(s.status.text).toBe('$(eye) Tell: F');
      expect(s.status.visible).toBe(true);

      const hover = s.providers.hover!.provideHover(s.doc, { line: errors[0].range.sl, character: 4 });
      expect(hover.contents.value).toContain('**Fix:**');
      expect(hover.contents.value).toContain('command:tell.showFix?');

      const actions = s.providers.actions!.provideCodeActions(s.doc, errors[0].range, { diagnostics: [errors[0]] });
      expect(actions).toHaveLength(1);
      expect(actions[0].title).toBe("Show Tell's fix");
      expect((actions[0].command.arguments[0] as { index: number }).index).toBeGreaterThanOrEqual(0);
    } finally {
      (Module as unknown as { _load: Function })._load = load;
    }
  });
});
