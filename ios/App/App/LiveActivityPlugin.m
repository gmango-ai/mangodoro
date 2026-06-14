#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift LiveActivityPlugin class with the Capacitor bridge
// under the JS name "LiveActivity" (matches registerPlugin('LiveActivity')
// in src/lib/persistentTimer.js).
//
// In-app plugins do NOT auto-discover via CAPBridgedPlugin — only plugins
// shipped as npm packages do. This macro is the explicit registration
// path the Capacitor iOS runtime scans at launch.
CAP_PLUGIN(LiveActivityPlugin, "LiveActivity",
           CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
