# Setup Guide

ddd を動かすまでの初期設定ガイド。

## 1. Discord Bot の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) を開く
2. **New Application** をクリックし、名前を付けて作成
3. 左メニュー **Bot** を開く
4. **Reset Token** をクリックしてトークンをコピー（この値を `ddd.toml` に設定する）
5. 同じページの **Privileged Gateway Intents** で **Message Content Intent** を ON にする

## 2. Bot をサーバーに招待

1. 左メニュー **OAuth2** → **URL Generator** を開く
2. **Scopes** で `bot` にチェック
3. **Bot Permissions** で以下にチェック:
   - Send Messages
   - Read Message History
4. 生成された URL をブラウザで開き、Bot を追加するサーバーを選択

## 3. チャンネル ID の取得

1. Discord クライアントで **ユーザー設定 → 詳細設定 → 開発者モード** を ON にする
2. 対象チャンネルを右クリック → **チャンネル ID をコピー**

## 4. プロジェクトの初期化

```bash
ddd init
```

`ddd.toml` と `hooks/echo.sh` が生成される。

## 5. 設定ファイルの編集

`ddd.toml` にトークンとチャンネル ID を設定:

```toml
[bot]
token = "YOUR_BOT_TOKEN"

[channels.general]
id = "123456789012345678"
on_message = "./hooks/echo.sh"
```

トークンは環境変数 `DDD_TOKEN` でも指定できる:

```bash
export DDD_TOKEN="YOUR_BOT_TOKEN"
```

## 6. 起動

```bash
ddd start           # 通常起動
ddd start -c path   # 設定ファイルのパスを指定
```

開発時はファイル変更で自動リスタートするモードが便利:

```bash
bun run dev
```

## 7. 動作確認

Discord で設定したチャンネルにメッセージを送る。`echo.sh` が動いていれば、送ったメッセージがそのままオウム返しされる。
