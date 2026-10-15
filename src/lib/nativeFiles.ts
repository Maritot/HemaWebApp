import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Universal Mobile Native File Exporter
 * 1. Writes file directly to Android Filesystem (Cache + Documents)
 * 2. Invokes native Android Share Sheet allowing user to save directly to Downloads, Drive, or WhatsApp
 * 3. Falls back to browser Blob download when run on desktop web
 */
export async function exportAndSaveFile(options: {
  filename: string;
  content: string;
  mimeType: string;
  title: string;
}): Promise<{ success: boolean; method: 'native_share' | 'browser_download'; message: string }> {
  const { filename, content, mimeType, title } = options;

  // 1. Try Native Capacitor Filesystem + Native Share Sheet
  try {
    // Write file to Cache directory first for sharing
    await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });

    // Also attempt writing to Documents so user has a local copy
    try {
      await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });
    } catch (e) {
      // Non-fatal if Documents restricted by scoped storage
    }

    const fileUri = await Filesystem.getUri({
      path: filename,
      directory: Directory.Cache
    });

    const canShare = await Share.canShare().catch(() => ({ value: false }));

    if (canShare.value && fileUri.uri) {
      await Share.share({
        title,
        text: `Exported from Hema: ${filename}`,
        url: fileUri.uri,
        dialogTitle: `Save ${filename}`
      });

      return {
        success: true,
        method: 'native_share',
        message: `File ready! Choose 'Save to Downloads' or share via WhatsApp/Drive.`
      };
    }
  } catch (err: any) {
    console.warn('[NativeFiles] Native file write/share threw:', err);
  }

  // 2. Web Browser Fallback (<a download>)
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 1500);

    return {
      success: true,
      method: 'browser_download',
      message: `Downloaded ${filename} to your device.`
    };
  } catch (err: any) {
    return {
      success: false,
      method: 'browser_download',
      message: `Failed to download: ${err?.message || 'Unknown error'}`
    };
  }
}
