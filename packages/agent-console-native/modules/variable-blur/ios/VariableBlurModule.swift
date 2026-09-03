import ExpoModulesCore

public class VariableBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VariableBlur")

    View(VariableBlurView.self) {
      Prop("blurRadius") { (view: VariableBlurView, radius: Double) in
        view.maxBlurRadius = radius
      }

      Prop("direction") { (view: VariableBlurView, direction: String) in
        view.direction = direction == "up" ? .up : .down
      }
    }
  }
}
