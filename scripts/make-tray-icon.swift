// Draws the menu-bar shard: the crystal's hexagon as a hairline outline, with one facet line.
//
// A menu-bar icon has to be a "template" image: black on transparent, which macOS then tints to
// suit a light or dark menu bar. The logo is a full-colour illustration and turns to a smudge at
// 16 points, so the shard is the crystal's silhouette alone. Two sizes, because the menu bar
// asks for the @2x one on a Retina screen.
//
// Usage: swift scripts/make-tray-icon.swift <out-dir>
import AppKit

let args = CommandLine.arguments
guard args.count == 2 else {
  FileHandle.standardError.write("usage: make-tray-icon.swift <out-dir>\n".data(using: .utf8)!)
  exit(1)
}

func draw(scale: CGFloat, to file: String) {
  // 18 points tall is the menu bar's comfortable height; the hexagon keeps the crystal's
  // proportions (5rem wide by 6.8rem tall) inside it.
  let width: CGFloat = 16, height: CGFloat = 18
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
  ) else { exit(1) }
  bitmap.size = NSSize(width: width, height: height)

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

  let h: CGFloat = 16, w = h * (5.0 / 6.8)
  let x0 = (width - w) / 2, y0 = (height - h) / 2
  let point = { (fx: CGFloat, fy: CGFloat) in NSPoint(x: x0 + w * fx, y: y0 + h * fy) }

  let hexagon = NSBezierPath()
  hexagon.move(to: point(0.5, 1))
  hexagon.line(to: point(1, 0.74))
  hexagon.line(to: point(1, 0.26))
  hexagon.line(to: point(0.5, 0))
  hexagon.line(to: point(0, 0.26))
  hexagon.line(to: point(0, 0.74))
  hexagon.close()
  hexagon.lineWidth = 1.2
  hexagon.lineJoinStyle = .round
  NSColor.black.setStroke()
  hexagon.stroke()

  // One facet line, the same diagonal the crystal body carries, so it reads as cut, not flat.
  let facet = NSBezierPath()
  facet.move(to: point(0.5, 1))
  facet.line(to: point(0.5, 0.42))
  facet.line(to: point(1, 0.26))
  facet.lineWidth = 0.9
  NSColor.black.withAlphaComponent(0.7).setStroke()
  facet.stroke()

  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
  try? png.write(to: URL(fileURLWithPath: file))
}

draw(scale: 1, to: "\(args[1])/crystalTemplate.png")
draw(scale: 2, to: "\(args[1])/crystalTemplate@2x.png")
