import ExpoModulesCore
import UIKit
import CoreImage.CIFilterBuiltins
import QuartzCore

/// Progressive backdrop blur via private `CAFilter.variableBlur`.
///
/// Based on react-native-variable-blur / jtrivedi/VariableBlurView, with two
/// fixes for our layout:
/// 1. Never call `super.updateProperties()` — on iOS 26 it reinstalls the stock
///    gaussian blur and wipes the variable-radius mask (reads as uniform blur).
/// 2. Size the gradient mask to the view's live bounds, not a fixed 100×100 tile.
final class VariableBlurView: ExpoView {
  enum Direction {
    case up
    case down
  }

  private let blurView = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))

  var maxBlurRadius: CGFloat = 20 {
    didSet { applyVariableBlur() }
  }

  var direction: Direction = .up {
    didSet { applyVariableBlur() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    addSubview(blurView)
    blurView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      blurView.leadingAnchor.constraint(equalTo: leadingAnchor),
      blurView.trailingAnchor.constraint(equalTo: trailingAnchor),
      blurView.topAnchor.constraint(equalTo: topAnchor),
      blurView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
    // Drop the tint/dimming subviews so we don't get a hard material edge.
    for subview in blurView.subviews.dropFirst() {
      subview.alpha = 0
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    applyVariableBlur()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let window, let backdropLayer = blurView.subviews.first?.layer else { return }
    // Avoid pixelization at the unblurred edge (nikstar/VariableBlur#1).
    backdropLayer.setValue(window.traitCollection.displayScale, forKey: "scale")
    applyVariableBlur()
  }

  private func applyVariableBlur() {
    let clsName = String("retliFAC".reversed())
    guard let filterClass = NSClassFromString(clsName) as? NSObject.Type else {
      NSLog("[VariableBlur] CAFilter class unavailable")
      return
    }
    let selector = NSSelectorFromString(String(":epyThtiWretlif".reversed()))
    guard let variableBlur = filterClass.perform(selector, with: "variableBlur").takeUnretainedValue() as? NSObject else {
      NSLog("[VariableBlur] variableBlur filter unavailable")
      return
    }

    let width = max(bounds.width, 1)
    let height = max(bounds.height, 1)
    let gradientImage = makeGradientImage(width: width, height: height, direction: direction)

    variableBlur.setValue(maxBlurRadius, forKey: "inputRadius")
    variableBlur.setValue(gradientImage, forKey: "inputMaskImage")
    variableBlur.setValue(true, forKey: "inputNormalizeEdges")

    blurView.subviews.first?.layer.filters = [variableBlur]
  }

  private func makeGradientImage(width: CGFloat, height: CGFloat, direction: Direction) -> CGImage {
    let filter = CIFilter.linearGradient()
    filter.color0 = CIColor.black
    filter.color1 = CIColor.clear
    filter.point0 = CGPoint(x: 0, y: height)
    filter.point1 = CGPoint(x: 0, y: 0)
    if direction == .up {
      filter.point0 = CGPoint(x: 0, y: 0)
      filter.point1 = CGPoint(x: 0, y: height)
    }
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    return CIContext().createCGImage(filter.outputImage!, from: rect)!
  }
}
