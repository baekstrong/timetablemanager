#!/bin/zsh
# 수업 음성 메모 자동화를 launchd에 등록한다 (이 Mac 사용자 전용).
# 음성 메모 폴더가 바뀔 때·15분마다·로그인 때 pipeline.mjs 실행 → 잠자기 중 쌓인 녹음도 깨어난 뒤 한꺼번에 처리.
#   zsh scripts/class-voice-memo/install.sh            등록(재등록)
#   zsh scripts/class-voice-memo/install.sh --remove   해제
set -eu
LABEL=kr.geunryeok.class-voice-memo
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="${0:A:h}"
STATE="$HOME/Library/Application Support/ClassVoiceMemo"
REC="$HOME/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
if [[ "${1:-}" == "--remove" ]]; then rm -f "$PLIST"; echo "해제 완료"; exit 0; fi

mkdir -p "$STATE"
# 처음 설치면 지금 있는 녹음은 전부 처리한 것으로 표시 (과거 개인 녹음 보호)
[[ -f "$STATE/processed.json" ]] || node "$DIR/pipeline.mjs" --seed

# 음성 메모 폴더는 macOS 개인정보 보호 대상이라 '전체 디스크 접근 권한'이 필요하다.
# node 자체에 권한을 주면 모든 node 프로그램이 얻게 되므로, 이 일만 하는 작은 앱을 만들어 그 앱에만 권한을 준다.
APP="$HOME/Applications/ClassVoiceMemo.app"
NODE="$(command -v node)"
PATHS="${NODE:h}:/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin"
mkdir -p "$HOME/Applications"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"export PATH='$PATHS'; cd '${DIR:h:h}' && '$NODE' '$DIR/pipeline.mjs' >> '$STATE/launchd.log' 2>&1 || true\""
defaults write "$APP/Contents/Info" LSUIElement -bool true   # Dock에 안 뜨게
defaults write "$APP/Contents/Info" CFBundleIdentifier "$LABEL"
codesign --force --sign - "$APP" 2>/dev/null

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/applet</string></array>
  <key>WatchPaths</key><array><string>$REC</string></array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$STATE/launchd.log</string>
  <key>StandardErrorPath</key><string>$STATE/launchd.log</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$UID" "$PLIST"
echo "등록 완료: $PLIST"
