import React, { useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'

function AvatarModel({ vrm, isSpeaking, emotion }) {
  // Animation loop
  useFrame((state, delta) => {
    if (vrm) {
      vrm.update(delta)

      // 1. Fake Procedural Lip-Sync
      if (vrm.expressionManager) {
        if (isSpeaking) {
          // Rapidly fluctuate mouth to simulate talking (sine wave)
          const mouthOpen = (Math.sin(state.clock.elapsedTime * 18) + 1) / 2
          vrm.expressionManager.setValue('aa', mouthOpen * 0.9)
        } else {
          vrm.expressionManager.setValue('aa', 0)
        }
        
        // 2. Emotions (mapped from the backend string to official VRM names)
        vrm.expressionManager.setValue('joy', emotion === 'happy' ? 1 : 0)
        vrm.expressionManager.setValue('sorrow', emotion === 'sad' ? 1 : 0)
        vrm.expressionManager.setValue('angry', emotion === 'angry' ? 1 : 0)
      }
      
      // 3. Idle Breathing & Procedural Emotion Gestures
      const t = state.clock.elapsedTime
      if (vrm.humanoid) {
        const spine = vrm.humanoid.getNormalizedBoneNode('spine')
        const head = vrm.humanoid.getNormalizedBoneNode('head')
        const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
        const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
        const leftElbow = vrm.humanoid.getNormalizedBoneNode('leftLowerArm')
        const rightElbow = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')
        
        if (spine) {
           spine.rotation.x = Math.sin(t * 1.5) * 0.02 // Breathing chest
           spine.rotation.y = Math.cos(t * 0.8) * 0.03 // Gentle sway
        }
        
        // Emotional Gestures!
        if (emotion === 'happy' && isSpeaking) {
          // Expressive, bouncy, arms slightly up
          if (leftArm) leftArm.rotation.z = 1.0 + Math.sin(t * 5) * 0.1
          if (rightArm) rightArm.rotation.z = -1.0 - Math.sin(t * 5) * 0.1
          if (leftElbow) leftElbow.rotation.z = 0.5 + Math.sin(t * 4) * 0.1
          if (rightElbow) rightElbow.rotation.z = -0.5 - Math.sin(t * 4) * 0.1
        } else if (emotion === 'angry' && isSpeaking) {
          // Tense, arms crossed or tight
          if (leftArm) leftArm.rotation.z = 1.3
          if (rightArm) rightArm.rotation.z = -1.3
          if (leftElbow) leftElbow.rotation.z = 1.0
          if (rightElbow) rightElbow.rotation.z = -1.0
          if (spine) spine.rotation.x = 0.1 // Leaning forward angrily
        } else if (emotion === 'sad') {
          // Slouched, looking down
          if (spine) spine.rotation.x = -0.1
          if (head) head.rotation.x = -0.2
          if (leftArm) leftArm.rotation.z = 1.2
          if (rightArm) rightArm.rotation.z = -1.2
          if (leftElbow) leftElbow.rotation.z = 0.1
          if (rightElbow) rightElbow.rotation.z = -0.1
        } else {
          if (leftArm) leftArm.rotation.z = -1.08 + Math.sin(t * 1.1) * 0.015
          if (rightArm) rightArm.rotation.z = 1.08 - Math.sin(t * 1.1) * 0.015
          if (leftElbow) leftElbow.rotation.z = -0.18
          if (rightElbow) rightElbow.rotation.z = 0.18
        }

        if (head && !isSpeaking && emotion !== 'sad') {
           head.rotation.y = Math.sin(t * 0.5) * 0.03 // Gentle look around
           head.rotation.x = Math.sin(t * 0.3) * 0.01
        }
      }
    }
  })

  return <primitive object={vrm.scene} position={[0, -1.45, 0]} />
}

export default function VrmAvatar({ isSpeaking, emotion }) {
  const [vrm, setVrm] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let model
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    
    loader.load(
      '/model.vrm',
      (gltf) => {
        if (disposed) { VRMUtils.deepDispose(gltf.scene); return }
        const loadedVrm = gltf.userData.vrm
        if (!loadedVrm) { VRMUtils.deepDispose(gltf.scene); setFailed(true); return }
        model = loadedVrm
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        VRMUtils.removeUnnecessaryJoints(gltf.scene)
        
        loadedVrm.scene.rotation.y = 0 
        
        // Let the VRM handle its own T-Pose / A-Pose natively
        // Some models break if we force manual bone rotations on boot

        setVrm(loadedVrm)
      },
      undefined,
      () => { if (!disposed) setFailed(true) }
    )
    return () => { disposed = true; if (model) VRMUtils.deepDispose(model.scene) }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}>
      {(!vrm || failed) && <div className="avatar-fallback"><img src="/elara_new.jpg" alt="Alia avatar" /><span>{failed ? 'Avatar unavailable' : 'Loading avatar...'}</span></div>}
      {/* Zoomed in closer to Z=3.1 and tilted slightly down to perfectly fit her large on a portrait mobile screen */}
      <Canvas camera={{ position: [0, -0.1, 3.1], fov: 40 }} gl={{ alpha: true }}>
        <ambientLight intensity={Math.PI} color="#ffffff" />
        <directionalLight position={[1, 2, 1]} intensity={1} color="#ffffff" />
        {vrm && <AvatarModel vrm={vrm} isSpeaking={isSpeaking} emotion={emotion} />}
      </Canvas>
    </div>
  )
}
