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
  const peerRef = useRef();

  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  useEffect(() => {
    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localVideo.current.srcObject = stream;
        socket.emit('join-room', { roomId, username });
      } catch (err) {
        console.error('Media Error:', err);
        alert('Camera/Mic access denied.');
      }
    };
    getMedia();
  }, [roomId, username]);

  const createPeerConnection = () => {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    };
    const peer = new RTCPeerConnection(config);

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('signal', {
          to: peerRef.current.remoteId,
          data: { candidate: e.candidate },
        });
      }
    };

    peer.ontrack = (e) => {
      remoteVideo.current.srcObject = e.streams[0];
    };

    return peer;
  };

  useEffect(() => {
    socket.on('user-joined', async ({ id }) => {
      peerRef.current = createPeerConnection();
      peerRef.current.remoteId = id;

      localVideo.current.srcObject.getTracks().forEach((track) => {
        peerRef.current.addTrack(track, localVideo.current.srcObject);
      });

      const offer = await peerRef.current.createOffer();
      await peerRef.current.setLocalDescription(offer);

      socket.emit('signal', {
        to: id,
        data: { sdp: offer },
      });
    });

    socket.on('signal', async ({ from, data }) => {
      if (!peerRef.current) {
        peerRef.current = createPeerConnection();
        peerRef.current.remoteId = from;

        localVideo.current.srcObject.getTracks().forEach((track) => {
          peerRef.current.addTrack(track, localVideo.current.srcObject);
        });
      }

      if (data.sdp) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
          const answer = await peerRef.current.createAnswer();
          await peerRef.current.setLocalDescription(answer);
          socket.emit('signal', {
            to: from,
            data: { sdp: answer },
          });
        }
      }

      if (data.candidate) {
        try {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('ICE Candidate Error:', err);
        }
      }
    });

    socket.on('chat-message', ({ username, message }) => {
      setChat((prev) => [...prev, { username, message }]);
    });

    return () => {
      socket.off('user-joined');
      socket.off('signal');
      socket.off('chat-message');
    };
  }, [roomId, username]);

  const sendMessage = () => {
    if (message.trim()) {
      socket.emit('chat-message', { roomId, username, message });
      setChat((prev) => [...prev, { username, message }]);
      setMessage('');
    }
  };

  const toggleMute = () => {
    const stream = localVideo.current.srcObject;
    if (stream) {
      stream.getAudioTracks().forEach((track) => (track.enabled = isMuted));
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = () => {
    const stream = localVideo.current.srcObject;
    if (stream) {
      stream.getVideoTracks().forEach((track) => (track.enabled = isCameraOff));
      setIsCameraOff(!isCameraOff);
    }
  };

  const leaveRoom = () => {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    const stream = localVideo.current.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

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
              <p key={i}>
                <b>{msg.username === username ? 'Me' : msg.username}:</b> {msg.message}
              </p>
            ))}
          </div>
          <div className="chat-input">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
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
          <button onClick={leaveRoom}>Leave Room</button>
        </div>
      </div>
    </div>
  );
}
