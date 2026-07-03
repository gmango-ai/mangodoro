const SUPABASE = "https://*.supabase.co wss://*.supabase.co";
const FONTS = "https://fonts.googleapis.com https://fonts.gstatic.com";
const OAUTH = "https://accounts.google.com https://*.googleusercontent.com";
const LIVEKIT = "https://*.livekit.cloud wss://*.livekit.cloud";
const JITSI = "https://meet.jit.si wss://meet.jit.si https://8x8.vc wss://8x8.vc https://*.8x8.vc wss://*.8x8.vc";

export function buildContentSecurityPolicy(customScheme: string, electronIsDev: boolean): string {
  const directives = [
    `default-src ${customScheme}://* 'unsafe-inline' 'unsafe-eval' data: blob:`,
    `connect-src ${customScheme}://* ${SUPABASE} ${OAUTH} ${LIVEKIT} ${JITSI} 'self' data: blob:`,
    `style-src ${customScheme}://* ${FONTS} 'unsafe-inline'`,
    `font-src ${customScheme}://* ${FONTS} data:`,
    `img-src ${customScheme}://* ${SUPABASE} ${OAUTH} https: data: blob:`,
    `script-src ${customScheme}://* https://meet.jit.si https://8x8.vc 'unsafe-inline' 'unsafe-eval'${electronIsDev ? ' devtools://*' : ''}`,
    `frame-src ${customScheme}://* https://meet.jit.si https://8x8.vc https://*.8x8.vc`,
    `media-src ${customScheme}://* ${SUPABASE} https: data: blob:`,
    `worker-src ${customScheme}://* blob:`,
  ];

  return directives.join("; ");
}
