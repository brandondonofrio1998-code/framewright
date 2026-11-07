import { describe, expect, it } from 'vitest';
import { assetForPlatform, parseRelease, versionNewer } from '../src/shared/release';

const body = {
  tag_name: 'v0.2.0',
  assets: [
    { name: 'Framewright-0.2.0-setup.exe', browser_download_url: 'https://github.com/brandondonofrio1998-code/framewright/releases/download/v0.2.0/Framewright-0.2.0-setup.exe' },
    { name: 'Framewright-0.2.0-portable.exe', browser_download_url: 'https://github.com/brandondonofrio1998-code/framewright/releases/download/v0.2.0/Framewright-0.2.0-portable.exe' },
    { name: 'Framewright-0.2.0-universal.dmg', browser_download_url: 'https://github.com/brandondonofrio1998-code/framewright/releases/download/v0.2.0/Framewright-0.2.0-universal.dmg' },
  ],
};

describe('release updates', () => {
  it('compares dotted versions and ignores a leading v', () => {
    expect(versionNewer('0.2.0', '0.1.0')).toBe(true);
    expect(versionNewer('v0.1.1', '0.1.0')).toBe(true);
    expect(versionNewer('0.1.0', '0.1.0')).toBe(false);
    expect(versionNewer('0.1.0', '0.2.0')).toBe(false);
  });

  it('picks the installer for this computer and skips the portable build', () => {
    const release = parseRelease(body);
    expect(release?.version).toBe('0.2.0');
    expect(assetForPlatform(release!.assets, 'win32')?.name).toBe('Framewright-0.2.0-setup.exe');
    expect(assetForPlatform(release!.assets, 'darwin')?.name).toBe('Framewright-0.2.0-universal.dmg');
    expect(assetForPlatform(release!.assets, 'linux')).toBeNull();
    expect(parseRelease({})).toBeNull();
  });
});
