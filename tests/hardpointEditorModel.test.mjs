import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveHardpointEditorPaletteId } from '../src/ui/hardpointEditorModel.js';

test('core brush resolves to the core palette item', () => {
  assert.equal(resolveHardpointEditorPaletteId({ tool: 'core' }), 'core');
});

test('bridge brush resolves to the bridge palette item', () => {
  assert.equal(resolveHardpointEditorPaletteId({ tool: 'bridge' }), 'bridge');
});

test('side engine brush keeps grouped side mount palette ids', () => {
  assert.equal(resolveHardpointEditorPaletteId({ tool: 'engine_side', engineMount: 'upper_left' }), 'engine_side_u');
  assert.equal(resolveHardpointEditorPaletteId({ tool: 'engine_side', engineMount: 'center_right' }), 'engine_side_c');
  assert.equal(resolveHardpointEditorPaletteId({ tool: 'engine_side', engineMount: 'lower_auto' }), 'engine_side_l');
});
