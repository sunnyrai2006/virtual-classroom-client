import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { socket } from '../socket';
import './Room.css';

export default function Room() {
  const { roomId } = useParams();
  const { state } = useLocation();
  const username = state?.username || 'Anonymous';

  const localVideo = useRef();
  const remoteVideo = useRef();
  const peerRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [devices, setDevices] = useState([]);
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0);
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  // Get video devices
  const getCameras = async () => {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
    setDevices(videoDevices);
    return videoDevices;
  };

  const startStream = async (deviceId = null) => {
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: true
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.current.srcObject = newStream;
    setStream(newStream);
    return newStream;
  };

  const initPeer = async (otherId, isInitiator) => {
    peerRef.current = new RTCPeerConnection();

    // Add tracks
    stream?.getTracks().forEach(track => {
      peerRef.current.addTrack(track, stream);
    });

    // Handle ICE
    peerRef.current.onicecandidate = e => {
      if (e.candidate) {
        socket.emit('signal', { to: otherId, data: { candidate: e.candidate } });
      }
    };

    // Set remote stream
    peerRef.current.ontrack = e => {
      remoteVideo.current.srcObject = e.streams[0];
    };

    if (isInitiator) {
      const offer = await peerRef.current.createOffer();
      await peerRef.current.setLocalDescription(offer);
      socket.emit('signal', { to: otherId, data: { sdp: offer } });
    }
  };

  useEffect(() => {
    (async () => {
      await getCameras();
      const camStream = await startStream();
      socket.emit('join-room', { roomId, username });
    })();
  }, []);

  useEffect(() => {
    socket.on('user-joined', async ({ id }) => {
      await initPeer(id, true);
    });

    socket.on('signal', async ({ from, data }) => {
      if (!peerRef.current) await initPeer(from, false);

      if (data.sdp) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
          const answer = await peerRef.current.createAnswer();
          await peerRef.current.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { sdp: answer } });
        }
      }

      if (data.candidate) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    socket.on('chat-message', ({ username, message }) => {
      setChat(prev => [...prev, { username, message }]);
    });

    return () => {
      socket.off('user-joined');
      socket.off('signal');
      socket.off('chat-message');
    };
  }, [stream]);

  const toggleMute = () => {
    if (stream) {
      stream.getAudioTracks().forEach(track => track.enabled = isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = () => {
    if (stream) {
      stream.getVideoTracks().forEach(track => track.enabled = isCameraOff);
      setIsCameraOff(!isCameraOff);
    }
  };

  const switchCamera = async () => {
    const newIndex = (currentDeviceIndex + 1) % devices.length;
    const newDevice = devices[newIndex];
    if (!newDevice) return;

    const newStream = await startStream(newDevice.deviceId);
    setCurrentDeviceIndex(newIndex);

    // Replace track in peer connection
    if (peerRef.current) {
      const sender = peerRef.current.getSenders().find(s => s.track.kind === 'video');
      if (sender) sender.replaceTrack(newStream.getVideoTracks()[0]);
    }
  };

  const sendMessage = () => {
    if (message.trim() === '') return;
    socket.emit('chat-message', { roomId, username, message });
    setChat(prev => [...prev, { username, message }]);
    setMessage('');
  };

  const leaveRoom = () => {
    if (peerRef.current) peerRef.current.close();
    if (stream) stream.getTracks().forEach(track => track.stop());
    socket.emit('leave-room', { roomId, username });
    window.location.href = '/';
  };

  return (
    <div className="room-container">
      <h2 className="room-title">Room: {roomId}</h2>

      <div className="both">
        <div className="video-container">
          <video ref={localVideo} autoPlay muted playsInline />
          <video ref={remoteVideo} autoPlay playsInline />
        </div>

        <div className="chat-container">
          <h3 style={{ textAlign: 'center' }}>Chat</h3>
          <div className="chat-messages">
            {chat.map((msg, i) => (
              <p key={i}><b>{msg.username === username ? 'Me' : msg.username}:</b> {msg.message}</p>
            ))}
          </div>
          <div className="chat-input">
            <input
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
            />
            <button onClick={sendMessage}>Send</button>
          </div>
        </div>
      </div>

      <div className="controls-bar">
        <div className="footer">
          <button onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>
          <button onClick={toggleCamera}>{isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}</button>
          <button onClick={switchCamera}>Switch Camera</button>
          <button onClick={leaveRoom}>Leave Room</button>
        </div>
      </div>
    </div>
  );
}
