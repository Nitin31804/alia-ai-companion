import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Sphere, MeshDistortMaterial } from '@react-three/drei'
import * as THREE from 'three'

function MagicalOrb({ isSpeaking }) {
  const outerSphere = useRef()
  const innerSphere = useRef()
  const clock = useRef(new THREE.Clock())

  useFrame(() => {
    const t = clock.current.getElapsedTime()
    
    // Rotate slowly
    if (outerSphere.current) {
      outerSphere.current.rotation.x = t * 0.2
      outerSphere.current.rotation.y = t * 0.3
      // Pulse if speaking
      const scale = isSpeaking ? 1 + Math.sin(t * 8) * 0.05 : 1
      outerSphere.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.1)
    }
    
    if (innerSphere.current) {
      innerSphere.current.rotation.x = t * -0.5
      innerSphere.current.rotation.y = t * 0.4
    }
  })

  return (
    <group>
      {/* Inner glowing core */}
      <Sphere ref={innerSphere} args={[1.2, 64, 64]}>
        <MeshDistortMaterial 
          color={isSpeaking ? "#a1c4fd" : "#fccb90"}
          emissive={isSpeaking ? "#c2e9fb" : "#d57eeb"}
          emissiveIntensity={2}
          distort={0.4}
          speed={isSpeaking ? 5 : 2}
          roughness={0.2}
          metalness={0.8}
        />
      </Sphere>

      {/* Outer glass shell */}
      <Sphere ref={outerSphere} args={[1.5, 64, 64]}>
        <meshPhysicalMaterial 
          color="#ffffff"
          transmission={0.9}
          opacity={1}
          metalness={0}
          roughness={0}
          ior={1.5}
          thickness={0.5}
          specularIntensity={1}
          specularColor="#ffffff"
          envMapIntensity={1}
        />
      </Sphere>
    </group>
  )
}

export default function Avatar({ isSpeaking }) {
  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center' 
    }}>
      <div style={{
        width: isSpeaking ? '160px' : '150px',
        height: isSpeaking ? '160px' : '150px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
        boxShadow: isSpeaking ? '0 0 40px #d57eeb' : '0 0 20px rgba(213, 126, 235, 0.5)',
        transition: 'all 0.2s ease-in-out'
      }} />
    </div>
  )
}
