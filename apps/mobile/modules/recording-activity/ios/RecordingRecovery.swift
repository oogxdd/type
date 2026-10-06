import Foundation

/// AVAudioRecorder writes PCM progressively. Repair RIFF/data lengths after a
/// crash or power loss without loading the recording into memory. Unknown
/// chunks (AVAudioRecorder may include JUNK/FLLR) are preserved.
enum RecordingRecovery {
  static func repairWave(_ url: URL) throws {
    let handle = try FileHandle(forUpdating: url)
    defer { try? handle.close() }
    let size = try handle.seekToEnd()
    guard size >= 12, size - 8 <= UInt64(UInt32.max) else { throw failure() }
    try handle.seek(toOffset: 0)
    let header = try handle.read(upToCount: 12) ?? Data()
    guard header.count == 12, String(data: header.prefix(4), encoding: .ascii) == "RIFF",
          String(data: header.suffix(4), encoding: .ascii) == "WAVE" else { throw failure() }
    var offset: UInt64 = 12
    var blockAlign: UInt64 = 0
    while offset + 8 <= size {
      try handle.seek(toOffset: offset)
      let chunk = try handle.read(upToCount: 8) ?? Data()
      guard chunk.count == 8 else { throw failure() }
      let name = String(data: chunk.prefix(4), encoding: .ascii)
      let length = UInt64(chunk[4]) | UInt64(chunk[5]) << 8 | UInt64(chunk[6]) << 16 | UInt64(chunk[7]) << 24
      if name == "fmt " {
        let format = try handle.read(upToCount: 16) ?? Data()
        guard format.count == 16, format[0] == 1, format[1] == 0 else { throw failure() }
        blockAlign = UInt64(format[12]) | UInt64(format[13]) << 8
      }
      if name == "data" {
        guard blockAlign > 0 else { throw failure() }
        let bytes = (size - offset - 8) / blockAlign * blockAlign
        guard bytes > 0 else { throw failure() }
        // Already finalized files can contain trailing metadata. Leave intact.
        if length > 0, length <= size - offset - 8,
           header[4..<8].enumerated().reduce(UInt64(0), { $0 | UInt64($1.element) << ($1.offset * 8) }) == size - 8 { return }
        let end = offset + 8 + bytes
        try handle.truncate(atOffset: end)
        try writeLength(UInt32(bytes), at: offset + 4, to: handle)
        try writeLength(UInt32(end - 8), at: 4, to: handle)
        try handle.synchronize()
        return
      }
      offset += 8 + length + (length % 2)
    }
    throw failure()
  }

  private static func writeLength(_ value: UInt32, at offset: UInt64, to handle: FileHandle) throws {
    var little = value.littleEndian
    try handle.seek(toOffset: offset)
    try handle.write(contentsOf: withUnsafeBytes(of: &little) { Data($0) })
  }

  private static func failure() -> NSError {
    NSError(domain: "TypeRecordingRecovery", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Recording has no recoverable PCM audio yet. The original file was retained."])
  }
}
