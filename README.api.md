post# Zalo Webservice API

Tài liệu endpoint cho webservice Zalo (REST wrapper quanh `zca-js`).

## 1) Environment

```env
PORT=3000
API_KEY=your_secret_key
ZALO_CREDENTIALS_PATH=./credentials.json
```

Header bắt buộc cho API protected:

```http
x-api-key: your_secret_key
Content-Type: application/json
```

## 2) Public Endpoints

### `GET /`
- Mô tả service.

### `GET /health`
- Health check.

### `GET /login`
- Trang web login QR.

### `POST /login/start`
- Bắt đầu flow QR login.

### `GET /login/state`
- Trạng thái login hiện tại.

### `GET /login/qr`
- Trả ảnh QR PNG hiện tại.

## 3) Auth Endpoint

### `POST /logout` (protected)
- Xóa credentials và reset session.

```bash
curl -X POST http://localhost:3000/logout \
  -H "x-api-key: your_secret_key"
```

## 4) Messaging Endpoints (protected)

### `POST /sendMessage`

```json
{
  "threadId": "123456789",
  "threadType": 0,
  "payload": {
    "msg": "hello"
  }
}
```

```bash
curl -X POST http://localhost:3000/sendMessage \
  -H "x-api-key: your_secret_key" \
  -H "Content-Type: application/json" \
  -d '{"threadId":"123456789","threadType":0,"payload":{"msg":"hello"}}'
```

### `POST /sendLink`
```json
{
  "threadId": "123456789",
  "threadType": 0,
  "msg": "xem link này",
  "link": "https://example.com"
}
```

### `POST /sendVoice`
```json
{
  "threadId": "123456789",
  "threadType": 0,
  "voiceUrl": "https://cdn.example.com/voice.m4a"
}
```

### `POST /sendVideo`
```json
{
  "threadId": "123456789",
  "threadType": 1,
  "payload": {
    "videoUrl": "https://cdn.example.com/video.mp4",
    "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
    "width": 720,
    "height": 1280,
    "duration": 12000,
    "msg": "video test"
  }
}
```

### `POST /uploadAttachment`
```json
{
  "threadId": "123456789",
  "threadType": 0,
  "files": ["/tmp/photo.jpg", "/tmp/doc.pdf"]
}
```

### `POST /undo`
```json
{
  "threadId": "123456789",
  "threadType": 0,
  "msgId": "1234567890123456789",
  "cliMsgId": 0
}
```

### `POST /addReaction`
```json
{
  "threadId": "123456789",
  "threadType": 0,
  "msgId": "1234567890123456789",
  "cliMsgId": "",
  "icon": "/-heart"
}
```

## 5) Poll Endpoints (protected)

### `POST /createPoll`
```json
{
  "threadId": "group_id_here",
  "payload": {
    "question": "Bạn chọn gì?",
    "options": ["A", "B"],
    "isAnonymous": false,
    "allowMultiChoices": false
  }
}
```

### `POST /votePoll`
```json
{
  "pollId": 123456,
  "optionIds": [0]
}
```

### `POST /lockPoll`
```json
{
  "pollId": 123456
}
```

### `POST /getPollDetail`
```json
{
  "pollId": 123456
}
```

## 6) User/Friend Endpoints (protected)

### `POST /findUser`
```json
{
  "query": "0912345678"
}
```

### `POST /getUserInfo`
```json
{
  "userId": "uid_here"
}
```

Hoặc:
```json
{
  "userIds": ["uid1", "uid2"]
}
```

### `POST /sendFriendRequest`
```json
{
  "userId": "uid_here",
  "message": "Xin chào!"
}
```

### `POST /getFriendRequestStatus`
```json
{
  "userId": "uid_here"
}
```

### `POST /getAllFriends`
```json
{}
```

## 7) Group Endpoints (protected)

### `POST /getAllGroups`
```json
{}
```

### `POST /getGroupInfo`
```json
{
  "groupId": "group_id_here"
}
```

Hoặc:
```json
{
  "groupIds": ["group1", "group2"]
}
```

### `POST /joinGroupLink`
```json
{
  "link": "https://zalo.me/g/xxxxxx"
}
```

### `POST /leaveGroup`
```json
{
  "groupId": "group_id_here"
}
```

## 8) Response Format

Thành công:

```json
{
  "ok": true,
  "data": {}
}
```

Lỗi:

```json
{
  "ok": false,
  "error": "error message"
}
```

## 9) Ghi chú

- `threadType`: `0` = DM, `1` = Group.
- API wrapper gọi trực tiếp `zca-js`, nên `payload` cần bám theo dữ liệu mà Zalo client API chấp nhận.
- Login QR là flow web (`/login`), không cần API key.
