import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

/**
 * Universal Camera & Photo Picker Utility
 * Works natively on Android via Capacitor with automatic HTML5 fallback.
 */
export async function capturePhoto(source: 'camera' | 'photos' = 'camera'): Promise<string | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      width: 1280,
      correctOrientation: true,
    });
    return photo.dataUrl || null;
  } catch (err: any) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('cancel') || msg.includes('user cancelled')) {
      return null;
    }
    // Fallback to HTML5 file/camera input
    return triggerHtml5Camera(source === 'camera');
  }
}

/**
 * HTML5 input fallback for desktop browsers or environments without Camera plugin permissions
 */
export function triggerHtml5Camera(isLiveCamera: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (isLiveCamera) {
      input.capture = 'environment';
    }
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = (re) => {
        resolve(re.target?.result as string);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
