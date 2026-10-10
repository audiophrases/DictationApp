import assert from 'node:assert/strict';
import { resolveVoice, VOICES, SELECTABLE_VOICES } from './ttsVoices.js';

// Default behaviour is unchanged for every language.
assert.equal(resolveVoice('en-US'), 'en-US-JennyNeural');
assert.equal(resolveVoice('fr-FR'), VOICES['fr-FR']);
assert.equal(resolveVoice('xx-XX'), 'en-US-JennyNeural');

// An approved voice can be requested by name (English only).
assert.equal(resolveVoice('en-US', 'en-US-EmmaMultilingualNeural'), 'en-US-EmmaMultilingualNeural');
for (const v of SELECTABLE_VOICES) assert.equal(resolveVoice('en-US', v), v);

// Unknown or hostile values fall back to the default voice.
assert.equal(resolveVoice('en-US', 'en-US-NopeNeural'), 'en-US-JennyNeural');
assert.equal(resolveVoice('en-US', '../../etc/passwd'), 'en-US-JennyNeural');
assert.equal(resolveVoice('en-US', ''), 'en-US-JennyNeural');
assert.equal(resolveVoice('en-US', null), 'en-US-JennyNeural');

// A requested English voice never overrides another language's voice.
assert.equal(resolveVoice('fr-FR', 'en-US-EmmaMultilingualNeural'), VOICES['fr-FR']);

console.log('tts voice selection tests passed');
