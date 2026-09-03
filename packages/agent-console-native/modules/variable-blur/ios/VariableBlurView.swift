import ExpoModulesCore
import UIKit
import CoreImage.CIFilterBuiltins
import QuartzCore

/// Progressive backdrop blur via private `CAFilter.variableBlur`.
///
/// Based on nikstar/VariableBlur + jtrivedi/VariableBlurView. The critical
/// iOS 26 fix is overriding `updateProperties` without calling `super` — UIKit's
/// default implementation reinstalls a uniform gaussian blur and ignores the
/// variable-radius mask.
final class VariableBlurView: ExpoView {
  enum Direction: String {
    case blurredTopClearBottom
    case blurredBottomClearTop
  }

  private let effectView = VariableBlurUIView()

  var maxBlurRadius: CGFloat = 20 {
    didSet { effectView.maxBlurRadius = maxBlurRadius }
  }

  var direction: Direction = .blurredTopClearBottom {
    didSet { effectView.direction = direction }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    isUserInteractionEnabled = false

    effectView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(effectView)
    NSLayoutConstraint.activate([
      effectView.leadingAnchor.constraint(equalTo: leadingAnchor),
      effectView.trailingAnchor.constraint(equalTo: trailingAnchor),
      effectView.topAnchor.constraint(equalTo: topAnchor),
      effectView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }
}

/// The actual `UIVisualEffectView` that owns the backdrop layer and filter.
private final class VariableBlurUIView: UIVisualEffectView {
  fileprivate var maxBlurRadius: CGFloat = 20 {
    didSet { installVariableBlur() }
  }

  fileprivate var direction: VariableBlurView.Direction = .blurredTopClearBottom {
    didSet { installVariableBlur() }
  }

  fileprivate init() {
    super.init(effect: UIBlurEffect(style: .regular))
    installVariableBlur()
    hideTintSubviews()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let window, let backdropLayer = backdropLayer else { return }
    // Avoid pixelization at the unblurred edge (nikstar/VariableBlur#1).
    backdropLayer.setValue(window.traitCollection.displayScale, forKey: "scale")
    installVariableBlur()
  }

  /// iOS 26 routes effect updates through here; calling `super` reinstalls the
  /// stock gaussian blur and wipes `variableBlur`.
  @available(iOS 26.0, *)
  override func updateProperties() {
    installVariableBlur()
  }

  @available(iOS 26.0, *)
  override func setNeedsUpdateProperties() {
    installVariableBlur()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    // nikstar/VariableBlur: calling super here crashes.
  }

  private var backdropLayer: CALayer? {
    subviews.first?.layer
  }

  private func hideTintSubviews() {
    for subview in subviews.dropFirst() {
      subview.alpha = 0
    }
  }

  private func installVariableBlur() {
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

    let gradientImage = makeGradientImage(width: 128, height: 128)

    variableBlur.setValue(maxBlurRadius, forKey: "inputRadius")
    variableBlur.setValue(gradientImage, forKey: "inputMaskImage")
    variableBlur.setValue(true, forKey: "inputNormalizeEdges")

    guard let backdropLayer else { return }
    backdropLayer.setValue(false, forKey: "allowsInPlaceFiltering")
    backdropLayer.filters = [variableBlur]
  }

  private func makeGradientImage(width: CGFloat, height: CGFloat) -> CGImage {
    // smoothLinearGradient eases the ramp. Endpoints span nearly the full mask
    // so the dissolve is long and gentle rather than a short step.
    let filter = CIFilter.smoothLinearGradient()
    filter.color0 = CIColor.black
    filter.color1 = CIColor.clear
    // Working on-device pairing: JS top uses "down" and bottom uses "up".
    // Do not invert these points independently of those props.
    let ramp = height * 0.96
    switch direction {
    case .blurredTopClearBottom:
      filter.point0 = CGPoint(x: 0, y: 0)
      filter.point1 = CGPoint(x: 0, y: ramp)
    case .blurredBottomClearTop:
      filter.point0 = CGPoint(x: 0, y: height)
      filter.point1 = CGPoint(x: 0, y: height - ramp)
    }
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    return CIContext().createCGImage(filter.outputImage!, from: rect)!
  }
}
