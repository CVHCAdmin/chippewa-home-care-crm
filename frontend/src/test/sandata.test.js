// Who gets the "check in on Sandata too" reminder, and which link each phone gets.
import { describe, test, expect, vi } from 'vitest';
import { needsSandata, smcLink, SMC_APP_STORE_URL, SMC_PLAY_URL } from '../utils/sandata';

describe('Sandata reminder', () => {
  test('only My Choice clients who are in Sandata (have a Medicaid ID) need Sandata', () => {
    expect(needsSandata({ referral_payer_type: 'mco_family_care', medicaid_id: '1421146410' })).toBe(true);
    expect(needsSandata({ referral_payer_type: 'mco_family_care', in_sandata: true })).toBe(true);      // cached offline copy
    expect(needsSandata({ referral_payer_type: 'mco_family_care' })).toBe(false);                    // My Choice, not EVV hours
    expect(needsSandata({ referral_payer_type: 'mco_family_care', medicaid_id: '1197148' })).toBe(false); // not an MA ID
    expect(needsSandata({ referral_payer_type: 'mco_family_care', medicaid_id: '1421146410', is_private_pay: true })).toBe(false);
    expect(needsSandata({})).toBe(false);                                  // no payer on file — nothing shown
    expect(needsSandata({ is_private_pay: true })).toBe(false);
    expect(needsSandata({ referral_payer_type: 'private_pay' })).toBe(false);
    expect(needsSandata({ referral_payer_type: 'va', medicaid_id: '1421146410' })).toBe(false); // VA is not a WI DMS payer
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

import { medicaidIdOf, copyText } from '../utils/sandata';
describe('Sandata client ID copy', () => {
  test('only a real 10-12 digit Medicaid ID is offered for copying', () => {
    expect(medicaidIdOf({ medicaid_id: ' 1421146410 ' })).toBe('1421146410');
    expect(medicaidIdOf({ medicaid_id: '1197148' })).toBeNull();
    expect(medicaidIdOf({ in_sandata: true })).toBeNull(); // offline cache never holds the ID
  });
  test('copies with the clipboard API, or falls back to select-and-copy', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('1421146410')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('1421146410');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('1421146410')).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
