import { css } from '@firebolt-dev/css'
import { useEffect, useMemo, useState } from 'react'
import { LoaderIcon, MessageCircleMoreIcon, UnplugIcon, WifiOffIcon } from 'lucide-react'

import { ContextWheel } from './ContextWheel'
import { InspectPane } from './InspectPane'
import { TransformPane } from './TransformPane'
import { CodePane } from './CodePane'
import { AvatarPane } from './AvatarPane'
import { ChatBox } from './ChatBox'
import { useElemSize } from './useElemSize'

export function GUI({ world }) {
  const [ref, width, height] = useElemSize()
  return (
    <div
      ref={ref}
      css={css`
        position: absolute;
        inset: 0;
      `}
    >
      {width > 0 && <Content world={world} width={width} height={height} />}
    </div>
  )
}

function Content({ world, width, height }) {
  const small = width < 600
  const touch = useMemo(() => navigator.userAgent.match(/OculusBrowser|iPhone|iPad|iPod|Android/i), [])
  const [ready, setReady] = useState(false)
  const [context, setContext] = useState(null)
  const [inspect, setInspect] = useState(null)
  const [transform, setTransform] = useState(null)
  const [code, setCode] = useState(false)
  const [chat, setChat] = useState(() => !touch)
  const [avatar, setAvatar] = useState(null)
  const [disconnected, setDisconnected] = useState(false)

  useEffect(() => {
    world.on('ready', setReady)
    world.on('context', setContext)
    world.on('inspect', setInspect)
    world.on('transform', setTransform)
    world.on('code', setCode)
    world.on('avatar', setAvatar)
    world.on('disconnect', setDisconnected)
    return () => {
      world.off('ready', setReady)
      world.off('context', setContext)
      world.off('inspect', setInspect)
      world.off('transform', setTransform)
      world.off('code', setCode)
      world.off('avatar', setAvatar)
      world.off('disconnect', setDisconnected)
    }
  }, [])

  return (
    <>
      {!chat && (
        <ChatBtn
          css={css`
            position: absolute;
            left: 20px;
            bottom: 20px;
          `}
          world={world}
          onClick={() => setChat(true)}
        />
      )}
      {chat && (
        <ChatBox
          css={css`
            position: absolute;
            bottom: 20px;
            left: 20px;
            width: 100%;
            max-width: 400px;
            @media all and (max-width: 440px) {
              right: 20px;
              width: inherit;
            }
          `}
          world={world}
          onClose={() => setChat(false)}
        />
      )}
      {context && <ContextWheel key={context.id} {...context} />}
      {inspect && <InspectPane key={`inspect-${inspect.data.id}`} world={world} entity={inspect} />}
      {transform && <TransformPane key={`transform-${transform.data.id}`} world={world} entity={transform} />}
      {inspect && code && <CodePane key={`code-${inspect.data.id}`} world={world} entity={inspect} />}
      {avatar && <AvatarPane key={avatar.hash} world={world} info={avatar} />}
      {disconnected && <Disconnected />}
      {!ready && <LoadingOverlay />}
    </>
  )
}

function ChatBtn({ ...props }) {
  return (
    <div
      css={css`
        position: absolute;
        bottom: 20px;
        left: 20px;
        width: 50px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.2);
        transition: background 0.15s ease-out;
        border-radius: 25px;
        pointer-events: auto;
        &:hover {
          background: rgba(0, 0, 0, 0.8);
          cursor: pointer;
        }
      `}
      {...props}
    >
      <MessageCircleMoreIcon size={20} />
    </div>
  )
}

function Disconnected() {
  return (
    <div
      css={css`
        position: absolute;
        top: 20px;
        right: 20px;
        background: rgba(22, 22, 28, 1);
        border: 1px solid rgba(255, 255, 255, 0.03);
        box-shadow: rgba(0, 0, 0, 0.5) 0px 10px 30px;
        height: 40px;
        border-radius: 20px;
        display: flex;
        align-items: center;
        padding: 0 14px 0 17px;
        svg {
          margin-left: 8px;
        }
        span {
          font-size: 14px;
        }
      `}
    >
      <span>Disconnected</span>
      <WifiOffIcon size={16} />
    </div>
  )
}

function LoadingOverlay() {
  return (
    <div
      css={css`
        position: absolute;
        inset: 0;
        background: black;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        svg {
          animation: spin 1s linear infinite;
        }
      `}
    >
      <LoaderIcon size={30} />
    </div>
  )
}
