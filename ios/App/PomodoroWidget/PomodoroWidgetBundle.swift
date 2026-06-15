import WidgetKit
import SwiftUI

@main
struct PomodoroWidgetBundle: WidgetBundle {
    var body: some Widget {
        PomodoroHomeWidget()
        if #available(iOS 16.1, *) {
            PomodoroLiveActivity()
        }
    }
}
