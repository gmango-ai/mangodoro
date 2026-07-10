import Capacitor
import UIKit

/// Custom Capacitor bridge view controller.
///
/// 1. Explicitly registers the in-app `LiveActivityPlugin` (Capacitor 8 only
///    auto-discovers plugins shipped as npm packages; in-app plugins register
///    here).
/// 2. Disables Apple Pencil **Scribble** on the web view (see below).
///
/// Wire-up: in Main.storyboard the root view controller's "Custom Class"
/// is set to `MangodoroBridgeViewController` (Identity Inspector → Class).
class MangodoroBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        removePencilScribble()
        // WebKit re-creates its content-view interactions asynchronously (and
        // when a text field focuses), so reapply a few times to be safe.
        for delay in [0.4, 1.5, 3.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.removePencilScribble()
            }
        }
    }

    /// Turn off Apple Pencil "Scribble" over the web view.
    ///
    /// The whiteboard uses the Pencil for freehand drawing. Without this, iOS
    /// Scribble intercepts handwriting-like Pencil strokes as text input — so
    /// writing (e.g. "hello") loses strokes mid-word and a Copy/Look-Up
    /// selection callout appears, while big free-form doodles (which don't look
    /// like handwriting) draw fine. We use Scribble nowhere in the web UI, so we
    /// strip its interactions off the WKWebView's content view. This is the only
    /// place it can be disabled — it's a system gesture web code can't suppress.
    private func removePencilScribble() {
        let root: UIView = bridge?.webView ?? view
        func walk(_ v: UIView) {
            // Match by class name: UIIndirectScribbleInteraction (the one WKWebView
            // actually uses) is generic, so `is` casts don't compile. String match
            // catches UIScribbleInteraction, UIIndirectScribbleInteraction, and any
            // private variants, on any iOS version.
            for interaction in v.interactions
            where NSStringFromClass(type(of: interaction)).contains("ScribbleInteraction") {
                v.removeInteraction(interaction)
            }
            v.subviews.forEach(walk)
        }
        walk(root)
    }
}
