import UIKit
import Capacitor

extension Notification.Name {
    /// Posted when APNs hands us the device token, so LiveActivityPlugin can
    /// forward it to the JS layer (which uploads it via the device-register
    /// edge function under the user's auth).
    static let mangodoroDeviceTokenReceived = Notification.Name("mangodoro.deviceTokenReceived")
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Latest APNs device token (hex). Cached so the JS layer can pull it via
    /// LiveActivity.getDeviceToken() even if it attaches its listener after
    /// registration has already completed.
    static var deviceTokenHex: String?

    /// Route from an alert notification the user tapped BEFORE the JS listener
    /// was attached (e.g. a cold launch from the notification). Set by
    /// LiveActivityPlugin's push handler and drained by
    /// LiveActivityPlugin.getPendingNotificationURL() on boot so the deep-link
    /// isn't lost.
    static var pendingTappedURL: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Register for remote notifications so the server can reach this device.
        // This one token serves both SILENT (content-available) background
        // pushes that refresh the home-screen widget AND user-facing ALERT
        // pushes (native-push edge function). Registration alone needs no user
        // authorization — but alerts only DISPLAY once the user grants
        // notification permission (requested from JS via the Settings toggle →
        // LiveActivityPlugin.requestNotificationPermission). Foreground display
        // + tap handling for those alerts is done by LiveActivityPlugin, which
        // registers as Capacitor's pushNotificationHandler (so we don't fight
        // the LocalNotifications plugin over the UNUserNotificationCenter
        // delegate — Capacitor owns it and routes remote pushes to us).
        application.registerForRemoteNotifications()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // MARK: - Remote notifications (silent background push → home-widget refresh)

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenHex = deviceToken.map { String(format: "%02x", $0) }.joined()
        AppDelegate.deviceTokenHex = tokenHex
        NotificationCenter.default.post(
            name: .mangodoroDeviceTokenReceived,
            object: nil,
            userInfo: ["token": tokenHex]
        )
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Best-effort: without a token the silent-push widget refresh simply
        // doesn't run (the widget still self-heals on next app foreground).
    }

    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        // Our silent state-refresh push: merge the pushed snapshot into the
        // App Group and reload the home widget so it reflects the change made
        // on the other device, without opening the app.
        guard (userInfo["kind"] as? String) == "pomodoro-state" else {
            completionHandler(.noData)
            return
        }
        LiveActivityPlugin.applyRemoteWidgetState(userInfo)
        completionHandler(.newData)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
