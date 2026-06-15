import Capacitor

/// Custom Capacitor bridge view controller that explicitly registers
/// the in-app `LiveActivityPlugin`. Capacitor 8 only auto-discovers
/// plugins shipped as npm packages (via `capacitor.config.json`); for
/// plugins that live inside the app itself, the registration has to be
/// driven manually here.
///
/// Wire-up: in Main.storyboard the root view controller's "Custom Class"
/// is set to `MangodoroBridgeViewController` (Identity Inspector → Class).
class MangodoroBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
