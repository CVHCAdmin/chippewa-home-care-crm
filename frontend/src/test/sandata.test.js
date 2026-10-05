// Who gets the "check in on Sandata too" reminder, and which link each phone gets.
import { describe, test, expect } from 'vitest';
import { needsSandata, smcLink, SMC_APP_STORE_URL, SMC_PLAY_URL } from '../utils/sandata';

describe('Sandata reminder', () => {
  test('My Choice / Family Care and payer-unknown clients need Sandata; private pay and VA do not', () => {
    expect(needsSandata({ referral_payer_type: 'mco_family_care' })).toBe(true);
    expect(needsSandata({})).toBe(true);                                   // no payer on file — remind anyway
    expect(needsSandata({ is_private_pay: true })).toBe(false);
    expect(needsSandata({ referral_payer_type: 'private_pay' })).toBe(false);
    expect(needsSandata({ referral_payer_type: 'va' })).toBe(false);       // VA is not a WI DMS payer
    expect(needsSandata(undefined)).toBe(false);
  });

  test('Android opens the installed app (Play Store fallback); iPhone gets the App Store page', () => {
    const android = smcLink('Mozilla/5.0 (Linux; Android 14; SM-S931U) Chrome/152 Mobile');
    expect(android.startsWith('intent://#Intent;package=com.sandata.smc.prod;')).toBe(true);
    expect(android).toContain(encodeURIComponent(SMC_PLAY_URL));
    expect(smcLink('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(SMC_APP_STORE_URL);
    expect(smcLink('Mozilla/5.0 (Windows NT 10.0)')).toBe(SMC_PLAY_URL);
  });
});
