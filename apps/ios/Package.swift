// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TypeMobile",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "TypeDomain", targets: ["TypeDomain"])],
    targets: [
        .target(name: "TypeDomain"),
        .testTarget(name: "TypeDomainTests", dependencies: ["TypeDomain"])
    ]
)
