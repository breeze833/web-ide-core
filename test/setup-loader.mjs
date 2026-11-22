// Node ESM loader hook stubbing browser-only monaco-editor and CSS imports during headless unit tests

import { register } from 'node:module';

if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

const hookSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'monaco-editor' || specifier.startsWith('monaco-editor/')) {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export const editor={create(){return{updateOptions(){},addCommand(){},layout(){},setModel(){},focus(){},dispose(){}}},createModel(v,l){return{getValue(){return v},onDidChangeContent(){},dispose(){}}}};export const KeyMod={CtrlCmd:2048};export const KeyCode={KeyS:49,Equal:85,Minus:87,Digit0:21,KeyB:32};',
    };
  }
  if (specifier.endsWith('.css') || specifier.includes('?worker')) {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export default function(){}',
    };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript;base64,${Buffer.from(hookSource).toString('base64')}`, import.meta.url);
