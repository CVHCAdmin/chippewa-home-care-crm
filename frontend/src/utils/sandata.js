// Sandata Mobile Connect (SMC) — Wisconsin's DHS-provided EVV app.
//
// Until the CRM is a certified alternate EVV system (it isn't yet — see
// ALT-EVV-CERTIFICATION-GAP.md), every Medicaid / Family Care visit must ALSO be
// checked in and out on SMC at the client's home. Keying visits into the Sandata
// portal afterward counts as a manual entry, and too many got the agency flagged.
// This only opens the app — it cannot check the caregiver in for them.
//
// Store listings (Wisconsin DHS: search "Sandata Mobile Connect", dark blue logo):
//   Android  com.sandata.smc.prod
//   iPhone   id6451209985
// CVHC's Sandata agency ID. The portal login is "STX" + this; caregivers type the
// 5 digits into SMC when they set it up (DHS P-02745 "Sandata Agency ID Number").
export const SANDATA_AGENCY_ID = '95685';

export const SMC_ANDROID_PACKAGE = 'com.sandata.smc.prod';
export const SMC_PLAY_URL = `https://play.google.com/store/apps/details?id=${SMC_ANDROID_PACKAGE}`;
export const SMC_APP_STORE_URL = 'https://apps.apple.com/us/app/sandata-mobile-connect/id6451209985';

// Only My Choice (Family Care MCO) clients who are IN Sandata — i.e. have a Medicaid ID
// on file (loaded from Sandata's client export). Owner's rules: a caregiver with no My
// Choice client sees nothing about Sandata, and My Choice clients whose hours aren't
// EVV hours (not in Sandata — e.g. Trina Klukas, Denise Woods) get no Sandata either.
// Entering a client's Medicaid ID is what turns the reminder on for a new EVV client.
export function hasMedicaidId(client) {
  return !!client && (client.in_sandata === true || /^\d{10,12}$/.test(String(client.medicaid_id || '').trim()));
}
export function needsSandata(client) {
  if (!client || client.is_private_pay === true) return false;
  return client.referral_payer_type === 'mco_family_care' && hasMedicaidId(client);
}

export function smcLink(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  if (/iPhone|iPad|iPod/i.test(ua)) return SMC_APP_STORE_URL; // the App Store page shows "Open" when installed
  if (/Android/i.test(ua)) {
    // Opens the installed app; Chrome falls back to the Play Store page if it isn't.
    return `intent://#Intent;package=${SMC_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(SMC_PLAY_URL)};end`;
  }
  return SMC_PLAY_URL;
}

export function openSandata() {
  const url = smcLink();
  // An intent:// launch doesn't leave our page. A store page opens in a new tab so the
  // installed app never navigates away from the caregiver's dashboard.
  if (url.startsWith('intent:')) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}
