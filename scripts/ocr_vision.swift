import Foundation
import Vision

guard CommandLine.arguments.count >= 2 else {
  fputs("missing image path\n", stderr)
  exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
var output: [String] = []

let request = VNRecognizeTextRequest { request, error in
  if let error = error {
    fputs("\(error.localizedDescription)\n", stderr)
    return
  }
  let observations = request.results as? [VNRecognizedTextObservation] ?? []
  for observation in observations {
    if let text = observation.topCandidates(1).first?.string {
      output.append(text)
    }
  }
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

do {
  let handler = VNImageRequestHandler(url: imageURL, options: [:])
  try handler.perform([request])
  print(output.joined(separator: "\n"))
} catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(1)
}
