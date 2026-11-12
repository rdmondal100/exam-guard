import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

// Load Monaco from the bundle, not a CDN: the CSP allows only 'self' and blob: workers.
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker(),
};
loader.config({ monaco });
