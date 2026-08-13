cask "dueflow" do
  arch arm: "arm64", intel: "x86_64"

  version "0.1.4"
  sha256 arm:   "a05ef5a8724e80f3de1c64b499112b293f998f984e5207b6f668d156c33d347b",
         intel: "d874667ff10be1c7a112f0a76d4371a809a87c194ff20d2db9395211d63cf1df"

  url "https://github.com/Ustinian5/DueFlow/releases/download/v#{version}/DueFlow-Desktop_#{version}_#{arch}.app.zip",
      verified: "github.com/Ustinian5/DueFlow/"
  name "DueFlow Desktop"
  desc "Local-first deadline planner with reverse schedules and calendar export"
  homepage "https://ustinian5.github.io/DueFlow/"

  depends_on :macos

  app "DueFlow Desktop.app"

  zap trash: [
    "~/Library/Application Support/com.dueflow.desktop",
    "~/Library/Caches/com.dueflow.desktop",
    "~/Library/Preferences/com.dueflow.desktop.plist",
    "~/Library/Saved Application State/com.dueflow.desktop.savedState",
  ]

  caveats <<~EOS
    DueFlow Desktop #{version} is an open-source developer preview that is
    ad-hoc sealed but not Developer ID signed or notarized. macOS may request
    confirmation in System Settings > Privacy & Security before first launch.
  EOS
end
