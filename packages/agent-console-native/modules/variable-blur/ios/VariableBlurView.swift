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
    // Multi-stop mask with a long tail. Same orientation as the working
    // on-device pairing (JS top="down", bottom="up") — do not invert this.
    // CI y=0 is the image bottom. blurredTopClearBottom is black at y=0.
    let size = CGSize(width: width, height: height)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let image = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
      let colors = [
        UIColor.black.cgColor,
        UIColor.black.withAlphaComponent(0.62).cgColor,
        UIColor.black.withAlphaComponent(0.32).cgColor,
        UIColor.black.withAlphaComponent(0.12).cgColor,
        UIColor.clear.cgColor,
      ] as CFArray
      let locations: [CGFloat] = [0, 0.28, 0.55, 0.8, 1]
      guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: locations) else {
        return
      }
      // UIKit y=0 is top. Map the working CI points onto that:
      // blurredTopClearBottom: black at CI y=0 (bitmap bottom) → start at (0, height)
      // blurredBottomClearTop: black at CI y=height (bitmap top) → start at (0, 0)
      let start: CGPoint
      let end: CGPoint
      switch direction {
      case .blurredTopClearBottom:
        start = CGPoint(x: 0, y: height)
        end = CGPoint(x: 0, y: 0)
      case .blurredBottomClearTop:
        start = CGPoint(x: 0, y: 0)
        end = CGPoint(x: 0, y: height)
      }
      renderer.cgContext.drawLinearGradient(gradient, start: start, end: end, options: [])
    }
    return image.cgImage!
  }
}
