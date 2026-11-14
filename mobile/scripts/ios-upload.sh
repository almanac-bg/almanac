#!/bin/sh
# Builds the iPhone app and uploads it to App Store Connect (TestFlight), signed by Xcode for the App Store with the
# Apple ID signed in to Xcode (Settings → Accounts). The team has no registered iPhone, so there's no development
# profile to archive with: the archive is made unsigned, given its entitlements (push, links) with a local signature,
# and signed for the App Store as it's exported. The build number is App Store Connect's next.
#
#   mobile/scripts/ios-upload.sh            build and upload
#   mobile/scripts/ios-upload.sh export     build an .ipa only (in $OUT/export)
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
OUT="${OUT:-$(mktemp -d)}"
destination="${1:-upload}"

npx cap sync ios
rm -rf "$OUT/App.xcarchive"
xcodebuild -quiet -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" CODE_SIGNING_ALLOWED=NO archive
app="$OUT/App.xcarchive/Products/Applications/App.app"
for f in "$app"/Frameworks/*; do codesign --force -s - "$f"; done
codesign --force -s - --entitlements ios/App/App/AppRelease.entitlements "$app"

cat > "$OUT/options.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>teamID</key><string>CA38SQWUTC</string>
	<key>signingStyle</key><string>automatic</string>
	<key>destination</key><string>$destination</string>
	<key>uploadSymbols</key><true/>
	<key>manageAppVersionAndBuildNumber</key><true/>
</dict>
</plist>
PLIST
xcodebuild -quiet -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/options.plist" \
  -exportPath "$OUT/export" -allowProvisioningUpdates
echo "done: $OUT"
