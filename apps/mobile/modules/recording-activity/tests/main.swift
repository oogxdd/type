import Foundation
import AVFoundation
import Darwin

// Produce a real Apple WAV and kill the process before Core Audio closes it.
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--unfinished" {
  let url = URL(fileURLWithPath: CommandLine.arguments[2])
  let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: false)!
  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
  buffer.frameLength = 4096
  for index in 0..<4096 { buffer.int16ChannelData![0][index] = Int16(index) }
  let file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: false)
  try file.write(from: buffer)
  _exit(0)
}

func le(_ value: UInt32) -> Data {
  var value = value.littleEndian
  return withUnsafeBytes(of: &value) { Data($0) }
}
func wave(extra: Bool = false, pcm: Data = Data([1, 0, 2, 0, 3])) -> Data {
  var data = Data("RIFF".utf8) + le(0) + Data("WAVEfmt ".utf8) + le(16)
  data += Data([1, 0, 1, 0]) + le(24000) + le(48000) + Data([2, 0, 16, 0])
  if extra { data += Data("JUNK".utf8) + le(3) + Data([0, 0, 0, 0]) }
  data += Data("data".utf8) + le(0) + pcm
  return data
}
func length(_ data: Data, _ offset: Int) -> UInt32 {
  data[offset..<offset+4].enumerated().reduce(0) { $0 | UInt32($1.element) << ($1.offset * 8) }
}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
for extra in [false, true] {
  let url = root.appendingPathComponent("recover.wav")
  try wave(extra: extra).write(to: url)
  try RecordingRecovery.repairWave(url)
  let recovered = try Data(contentsOf: url)
  let dataOffset = extra ? 56 : 44
  precondition(recovered.count == dataOffset + 4)
  precondition(length(recovered, 4) == UInt32(recovered.count - 8))
  precondition(length(recovered, dataOffset - 4) == 4)
  precondition(recovered.suffix(4) == Data([1, 0, 2, 0]))
  try RecordingRecovery.repairWave(url)
  let repeated = try Data(contentsOf: url)
  precondition(repeated == recovered)
}
for input in [Data("not audio".utf8), wave(pcm: Data())] {
  let url = root.appendingPathComponent("invalid.wav")
  try input.write(to: url)
  do { try RecordingRecovery.repairWave(url); fatalError("invalid WAV accepted") }
  catch { let retained = try Data(contentsOf: url); precondition(retained == input) }
}
let apple = root.appendingPathComponent("apple.wav")
let child = Process()
child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
child.arguments = ["--unfinished", apple.path]
try child.run()
child.waitUntilExit()
precondition(child.terminationStatus == 0)
try RecordingRecovery.repairWave(apple)
let audio = try AVAudioFile(forReading: apple)
precondition(audio.length == 4096)
let actual = AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: 4096)!
try audio.read(into: actual)
precondition(actual.frameLength == 4096)
print("WAV recovery passed: synthetic RIFF, padding, incomplete frame, repeat repair, invalid/empty retention, and real Core Audio file after process death (4096 frames)")
