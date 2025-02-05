import { css } from '@firebolt-dev/css'
import { useEffect, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'
import { usePane } from './usePane'

function NumericInput({ label, value, onChange, step = 0.1, unit = '' }) {
  const [localValue, setLocalValue] = useState(value)
  
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <div className="transform-input">
      <label>{label}</label>
      <div className="input-group">
        <input
          type="number"
          value={localValue}
          step={step}
          onChange={(e) => {
            const val = parseFloat(e.target.value)
            setLocalValue(val)
            onChange(val)
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  )
}

export function TransformPane({ world, entity }) {
  const paneRef = useRef()
  const headRef = useRef()
  const [position, setPosition] = useState([0, 0, 0])
  const [rotation, setRotation] = useState([0, 0, 0])
  const [scale, setScale] = useState([1, 1, 1])
  const [uniformScale, setUniformScale] = useState(true)
  const [snapToGrid, setSnapToGrid] = useState(false)

  usePane('transform', paneRef, headRef)

  useEffect(() => {
    if (!entity) return
    // Initialize values from entity
    setPosition(entity.root.position.toArray())
    setRotation(entity.root.rotation.toArray().map(r => r * (180/Math.PI))) // Convert to degrees
    setScale(entity.root.scale.toArray())

    // Subscribe to transform updates
    const onTransform = () => {
      setPosition(entity.root.position.toArray())
      setRotation(entity.root.rotation.toArray().map(r => r * (180/Math.PI)))
      setScale(entity.root.scale.toArray())
    }
    entity.on('transform', onTransform)
    return () => entity.off('transform', onTransform)
  }, [entity])

  const updatePosition = (axis, value) => {
    if (!entity) return
    const newPos = [...position]
    newPos[axis] = snapToGrid ? Math.round(value) : value
    entity.root.position.fromArray(newPos)
    setPosition(newPos)
    entity.emit('transform')
  }

  const updateRotation = (axis, degrees) => {
    if (!entity) return
    const newRot = [...rotation]
    newRot[axis] = degrees
    entity.root.rotation.fromArray(newRot.map(d => d * (Math.PI/180))) // Convert to radians
    setRotation(newRot)
    entity.emit('transform')
  }

  const updateScale = (axis, value) => {
    if (!entity) return
    const newScale = [...scale]
    if (uniformScale) {
      newScale[0] = newScale[1] = newScale[2] = value
    } else {
      newScale[axis] = value
    }
    entity.root.scale.fromArray(newScale)
    setScale(newScale)
    entity.emit('transform')
  }

  return (
    <div
      ref={paneRef}
      css={css`
        position: absolute;
        top: 20px;
        right: 20px;
        width: 300px;
        background: rgba(22, 22, 28, 1);
        border: 1px solid rgba(255, 255, 255, 0.03);
        border-radius: 10px;
        box-shadow: rgba(0, 0, 0, 0.5) 0px 10px 30px;
        pointer-events: auto;
        color: white;

        .transform-head {
          height: 40px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          padding: 0 0 0 15px;
          &-title {
            flex: 1;
            font-weight: 500;
          }
          &-close {
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
          }
        }

        .transform-content {
          padding: 15px;
        }

        .transform-section {
          margin-bottom: 15px;
          
          h3 {
            font-size: 14px;
            margin-bottom: 10px;
            color: rgba(255, 255, 255, 0.7);
          }

          .inputs {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }
        }

        .transform-input {
          label {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.5);
            margin-bottom: 4px;
            display: block;
          }

          .input-group {
            position: relative;
            
            input {
              width: 100%;
              background: #252630;
              border: none;
              border-radius: 6px;
              padding: 6px 8px;
              color: white;
              font-size: 13px;
              
              &::-webkit-inner-spin-button {
                opacity: 0;
              }
              
              &:hover::-webkit-inner-spin-button {
                opacity: 1;
              }
            }

            .unit {
              position: absolute;
              right: 8px;
              top: 50%;
              transform: translateY(-50%);
              font-size: 12px;
              color: rgba(255, 255, 255, 0.3);
            }
          }
        }

        .transform-options {
          display: flex;
          gap: 10px;
          margin-top: 15px;

          label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;

            input {
              margin: 0;
            }
          }
        }
      `}
    >
      <div className="transform-head" ref={headRef}>
        <div className="transform-head-title">Transform</div>
        <div className="transform-head-close" onClick={() => world.emit('transform', null)}>
          <XIcon size={20} />
        </div>
      </div>

      <div className="transform-content">
        <div className="transform-section">
          <h3>Position</h3>
          <div className="inputs">
            <NumericInput label="X" value={position[0]} onChange={v => updatePosition(0, v)} unit="m" />
            <NumericInput label="Y" value={position[1]} onChange={v => updatePosition(1, v)} unit="m" />
            <NumericInput label="Z" value={position[2]} onChange={v => updatePosition(2, v)} unit="m" />
          </div>
        </div>

        <div className="transform-section">
          <h3>Rotation</h3>
          <div className="inputs">
            <NumericInput label="X" value={rotation[0]} onChange={v => updateRotation(0, v)} step={15} unit="°" />
            <NumericInput label="Y" value={rotation[1]} onChange={v => updateRotation(1, v)} step={15} unit="°" />
            <NumericInput label="Z" value={rotation[2]} onChange={v => updateRotation(2, v)} step={15} unit="°" />
          </div>
        </div>

        <div className="transform-section">
          <h3>Scale</h3>
          <div className="inputs">
            <NumericInput 
              label="X" 
              value={scale[0]} 
              onChange={v => updateScale(0, v)} 
              step={0.1}
              disabled={uniformScale}
            />
            <NumericInput 
              label="Y" 
              value={scale[1]} 
              onChange={v => updateScale(1, v)} 
              step={0.1}
              disabled={uniformScale}
            />
            <NumericInput 
              label="Z" 
              value={scale[2]} 
              onChange={v => updateScale(2, v)} 
              step={0.1}
              disabled={uniformScale}
            />
          </div>
        </div>

        <div className="transform-options">
          <label>
            <input
              type="checkbox"
              checked={uniformScale}
              onChange={e => setUniformScale(e.target.checked)}
            />
            Uniform Scale
          </label>
          <label>
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={e => setSnapToGrid(e.target.checked)}
            />
            Snap to Grid
          </label>
        </div>
      </div>
    </div>
  )
}
