// Cuts the macOS app icon out of `assets/logo.png`.
//
// Why not hand the logo straight to macOS: it is a full-bleed dark square, and recent macOS puts
// any icon that is not already the standard rounded square inside a grey plate of its own, which
// would sit a black square on grey in the dock. So the logo is clipped to Apple's icon shape and
// grid here (an 824px body inside a 1024px canvas) and zoomed so the glowing circle fills it.
//
// Usage: swift scripts/make-icon.swift <logo.png> <out.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let logo = NSImage(contentsOfFile: args[1]) else {
  FileHandle.standardError.write("usage: make-icon.swift <logo.png> <out.png>\n".data(using: .utf8)!)
  exit(1)
}

let canvas: CGFloat = 1024
let body = NSRect(x: 100, y: 100, width: 824, height: 824)

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: Int(canvas), pixelsHigh: Int(canvas),
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
) else { exit(1) }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

// Apple's corner is a continuous curve, not a circle arc; 22.5% of the body is the usual stand-in.
NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185).addClip()
// The logo's circle is about 80% of its image. Drawn at 1.2x the body, the circle nearly touches
// the icon's edges, which is how it reads at dock size rather than as a small ring in a black tile.
let side = body.width * 1.2
logo.draw(in: NSRect(x: canvas / 2 - side / 2, y: canvas / 2 - side / 2, width: side, height: side))

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: args[2]))
