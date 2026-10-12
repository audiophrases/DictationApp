import { MsEdgeTTS } from 'msedge-tts';

// Microsoft is moving Edge Read Aloud to a new host (2026-10, rany2/edge-tts#490).
// The legacy host (speech.platform.bing.com) now answers 403 for many regions and
// datacenters. The new host still accepts msedge-tts's legacy Sec-MS-GEC token, so
// only the URL changes. Remove once msedge-tts ships this itself.
const originalGetSynthUrl = MsEdgeTTS.getSynthUrl.bind(MsEdgeTTS);
MsEdgeTTS.getSynthUrl = async function getSynthUrl() {
  const url = new URL(await originalGetSynthUrl());
  url.host = 'api.msedgeservices.com';
  url.pathname = '/tts/cognitiveservices/websocket/v1';
  url.searchParams.set('Ocp-Apim-Subscription-Key', url.searchParams.get('TrustedClientToken'));
  url.searchParams.delete('TrustedClientToken');
  return url.toString();
};
