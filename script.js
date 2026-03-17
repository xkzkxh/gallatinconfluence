/* Cave Explorer — single-file app behavior.
   - No external assets required
   - Mouse = torch (spotlight)
   - Procedural cave walls + floor
   - Procedural bats + crawlers (animated)
   - Hover & click for info
   - Simple ambient + echo implemented with WebAudio (Delay feedback)
*/

// === Globals ===
let renderer, scene, camera;
let torch, torchVisual;
let raycaster, pointer;
let INTERACT_GROUP;
let audioCtx, masterGain, ambientNode;
let started = false;

// HTML elements
const enterBtn = document.getElementById('enterBtn');
const startOverlay = document.getElementById('startOverlay');
const infoCard = document.getElementById('infoCard');
const infoTitle = document.getElementById('infoTitle');
const infoText = document.getElementById('infoText');
const closeInfo = document.getElementById('closeInfo');

// ===== Profile Selection =====
const nameInput = document.getElementById('nameInput');
const welcomeMessage = document.getElementById('welcomeMessage');
let selectedProfile = null;

nameInput.addEventListener('input', () => {
  const name = nameInput.value.trim();
  if (name) {
    selectedProfile = name;
    welcomeMessage.textContent = `Welcome, ${name}!`;
    welcomeMessage.classList.remove('hidden');
    enterBtn.style.display = 'inline-block';
  } else {
    welcomeMessage.classList.add('hidden');
    enterBtn.style.display = 'none';
  }
});

enterBtn.style.display = 'none';
enterBtn.addEventListener('click', startExperience);
closeInfo.addEventListener('click', ()=> infoCard.classList.add('hidden'));

// === Start ===
function startExperience(){
  if (started) return;
  started = true;
  startOverlay.style.display = 'none';
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain(); masterGain.gain.value = 1.0; masterGain.connect(audioCtx.destination);
  createAmbientSound();
  initThree();
  createCave();
  createInteractables();
  initInput();
  animate();
}

// === Audio ===
function createAmbientSound(){
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 40;
  const oscGain = audioCtx.createGain();
  oscGain.gain.value = 0.02;
  osc.connect(oscGain);

  const bufferSize = 2 * audioCtx.sampleRate;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  let data = noiseBuffer.getChannelData(0);
  for (let i=0;i<bufferSize;i++) data[i] = (Math.random()*2 -1) * Math.exp(-i / (bufferSize*0.6));
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 800; noiseFilter.Q.value = 0.8;
  const noiseGain = audioCtx.createGain(); noiseGain.gain.value = 0.08;
  noise.connect(noiseFilter); noiseFilter.connect(noiseGain);

  const delay = audioCtx.createDelay(); delay.delayTime.value = 0.28;
  const feedback = audioCtx.createGain(); feedback.gain.value = 0.42;
  const wetGain = audioCtx.createGain(); wetGain.gain.value = 0.18;
  delay.connect(feedback); feedback.connect(delay); delay.connect(wetGain);

  oscGain.connect(masterGain);
  noiseGain.connect(delay);
  noiseGain.connect(masterGain);
  wetGain.connect(masterGain);
  osc.start(0); noise.start(0);

  ambientNode = { delay, feedback, wetGain };
}

function playEchoSound(){
  if (!audioCtx) return;
  const burst = audioCtx.createBufferSource();
  const bsize = Math.floor(audioCtx.sampleRate * 0.5);
  const bbuf = audioCtx.createBuffer(1, bsize, audioCtx.sampleRate);
  const d = bbuf.getChannelData(0);
  for (let i=0;i<bsize;i++) d[i] = (Math.random()*2 -1) * Math.exp(-i / (bsize*0.45));
  burst.buffer = bbuf;

  const filt = audioCtx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = 1400 + Math.random()*200;
  const g = audioCtx.createGain(); g.gain.value = 0.6;
  burst.connect(filt); filt.connect(g);

  const click = audioCtx.createOscillator();
  click.type = 'triangle'; click.frequency.value = 600 + Math.random()*600;
  const clickGain = audioCtx.createGain(); clickGain.gain.value = 0.0001;
  click.connect(clickGain); clickGain.connect(g);
  clickGain.gain.exponentialRampToValueAtTime(0.5, audioCtx.currentTime + 0.01);
  clickGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

  const localDelay = audioCtx.createDelay(); localDelay.delayTime.value = 0.18 + Math.random()*0.18;
  const localFB = audioCtx.createGain(); localFB.gain.value = 0.35 + Math.random()*0.15;
  g.connect(localDelay); localDelay.connect(localFB); localFB.connect(localDelay);
  localDelay.connect(masterGain); g.connect(masterGain);

  burst.start(); click.start();
  burst.stop(audioCtx.currentTime + 0.9); click.stop(audioCtx.currentTime + 0.45);
}

// === THREE.js initialization ===
function initThree(){
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020204);
  scene.fog = new THREE.FogExp2(0x000203, 0.03);

  camera = new THREE.PerspectiveCamera(52, window.innerWidth/window.innerHeight, 0.1, 200);
  camera.position.set(0, 1.6, 5);

  const hemi = new THREE.HemisphereLight(0x666666, 0x040409, 0.18);
  scene.add(hemi);

  torch = new THREE.SpotLight(0xfff5d6, 40, 25, Math.PI / 8, 0.4, 1);
  scene.add(torch); scene.add(torch.target);
  torch.shadow.mapSize.set(1024,1024); torch.position.set(0,3,3); scene.add(torch.target);

  const tvMat = new THREE.MeshBasicMaterial({ color: 0xfff5d6 });
  torchVisual = new THREE.Mesh(new THREE.SphereGeometry(0.03,8,8), tvMat);
  torchVisual.visible = true; scene.add(torchVisual);

  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
  INTERACT_GROUP = new THREE.Group(); scene.add(INTERACT_GROUP);
  window.addEventListener('resize', onWindowResize);
}

function deformGeometry(geometry, strength = 0.3) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(
      i,
      x + (Math.random() - 0.5) * strength,
      y + (Math.random() - 0.5) * strength,
      z + (Math.random() - 0.5) * strength
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createCrystalCluster(material) {
  const group = new THREE.Group();
  const shardCount = 3 + Math.floor(Math.random() * 4);

  for (let i = 0; i < shardCount; i++) {
    const geo = new THREE.ConeGeometry(
      0.15 + Math.random() * 0.25,
      0.6 + Math.random() * 1.2,
      6
    );
    deformGeometry(geo, 0.15);

    const shard = new THREE.Mesh(geo, material);
    shard.position.set(
      (Math.random() - 0.5) * 0.4,
      Math.random() * 0.3,
      (Math.random() - 0.5) * 0.4
    );
    shard.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    group.add(shard);
  }

  return group;
}

// === Cave ===
function createCave(){
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), floorMat);
  floor.rotation.x = -Math.PI/2; floor.position.y = -1.1; floor.receiveShadow = true;
  scene.add(floor);

  const ceilGeo = new THREE.SphereGeometry(40, 64, 32, 0, Math.PI*2, 0, Math.PI/2);
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 1.0 });
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
  ceiling.scale.set(1.2,0.9,1.2); ceiling.position.set(0,14,-10);
  scene.add(ceiling);

  const back = new THREE.Mesh(new THREE.BoxGeometry(80,30,2), new THREE.MeshStandardMaterial({ color:0x060607 }));
  back.position.set(0,8,-30); scene.add(back);

  // === Stalagmites (tall cones with spiky pokes) ===
const stalagMat = new THREE.MeshStandardMaterial({ color:0x222222, roughness:1 });
for (let i=0; i<12; i++){
    const height = 2.5 + Math.random()*3.0;
    const radius = 0.3 + Math.random()*0.3;
    const coneGeo = new THREE.ConeGeometry(radius, height, 10);
    deformGeometry(coneGeo, 0.05); // optional small wobble
    const stalag = new THREE.Mesh(coneGeo, stalagMat);
    stalag.position.set(-15 + Math.random()*30, -0.2, -5 - Math.random()*20);

    // add small spikes around the base
    const spikeCount = 4 + Math.floor(Math.random()*5);
    for(let s=0; s<spikeCount; s++){
        const spikeGeo = new THREE.ConeGeometry(0.05 + Math.random()*0.08, 0.2 + Math.random()*0.3, 5);
        deformGeometry(spikeGeo, 0.05);
        const spike = new THREE.Mesh(spikeGeo, stalagMat);
        const angle = Math.random()*Math.PI*2;
        const dist = radius + Math.random()*0.15;
        spike.position.set(
            stalag.position.x + Math.cos(angle)*dist,
            -0.2 + Math.random()*0.1,
            stalag.position.z + Math.sin(angle)*dist
        );
        spike.rotation.y = Math.random()*Math.PI*2;
        INTERACT_GROUP.add(spike);
        spike.userData = { type:'mineral', name:'Spiky Stalagmite', desc:'Smaller mineral pokes around main stalagmite.' };
    }

    INTERACT_GROUP.add(stalag);
    stalag.userData = { type:'mineral', name:'Stalagmite 🪨', desc:'Stalagmites form when mineral-rich water drips from cave ceilings and deposits calcium carbonate onto the floor. Over centuries to millennia, these deposits accumulate layer by layer, slowly growing upward. Each drip leaves behind a microscopic mineral ring, meaning stalagmites act as natural climate records — their growth patterns can reveal ancient rainfall, temperature, and atmospheric conditions!! Stalagmites grow extremely slowly, often less than a few millimeters per century. Touching them can disrupt mineral deposition and permanently halt growth.' };
}

  // === Crystal clusters on floor ===
  const crystalMat=new THREE.MeshStandardMaterial({ color:0x7be4ff, roughness:0.18, metalness:0.12, emissive:0x062f3b, emissiveIntensity:0.1 });
  for(let i=0;i<8;i++){
    const cluster=createCrystalCluster(crystalMat);
    cluster.position.set(-12+Math.random()*24, -0.4, -6-Math.random()*20);
    INTERACT_GROUP.add(cluster);
    cluster.userData={ type:'mineral', name:'Crystal Cluster 💎', desc:'Crystal clusters form when mineral-rich water seeps into cavities and slowly evaporates, allowing crystals to grow together in radiating groups. Common minerals include calcite and quartz. The stable cave environment lets these clusters develop sharp forms over thousands of years, making them extremely fragile and irreplaceable.'};
  }

  // === Ceiling stalactites, crystals, fungi ===
  const ceilingMat = new THREE.MeshStandardMaterial({ color:0x2a2a2a, roughness:1 });
  const fungusMat = new THREE.MeshStandardMaterial({ color:0x55aa33, roughness:0.9, emissive:0x22ff33, emissiveIntensity:0.15 });
  for(let i=0;i<60;i++){
    // Stalactite
    const h = 0.5 + Math.random()*1.2;
    const rTop = 0.02 + Math.random()*0.05;
    const rBottom = 0.08 + Math.random()*0.12;
    const stal = new THREE.ConeGeometry(rBottom,h,6);
    deformGeometry(stal,0.08);
    const sMesh = new THREE.Mesh(stal, ceilingMat);
    sMesh.position.set(-15+Math.random()*30, 13+Math.random()*1.5, -5-Math.random()*20);
    sMesh.rotation.x = Math.PI;
    sMesh.rotation.y = Math.random()*Math.PI*2;
    INTERACT_GROUP.add(sMesh);
    sMesh.userData={ type:'mineral', name:'Stalactite', desc:'Mineral formation hanging from ceiling.'};

    // Tiny crystal on ceiling
    if(Math.random()<0.4){
      const c = createCrystalCluster(crystalMat);
      c.position.set(sMesh.position.x+(-0.3+Math.random()*0.6), sMesh.position.y-0.1, sMesh.position.z+(-0.3+Math.random()*0.6));
      INTERACT_GROUP.add(c);
      c.userData={ type:'mineral', name:'Crystal Cluster', desc:'Shiny translucent crystals.'};
    }

    // Fungus/bacteria
    if(Math.random()<0.3){
      const fGeo = new THREE.SphereGeometry(0.05 + Math.random()*0.08, 6, 6);
      const fMesh = new THREE.Mesh(fGeo, fungusMat);
      fMesh.position.set(sMesh.position.x + (-0.1+Math.random()*0.2), sMesh.position.y - Math.random()*0.1, sMesh.position.z + (-0.1+Math.random()*0.2));
      INTERACT_GROUP.add(fMesh);
      fMesh.userData={ type:'fungi', name:'Cave Fungus', desc:'Bioluminescent fungus growing on the ceiling.'};
    }
  }
}

// === Interactables ===
function createInteractables(){
  // Bats
  const batMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7, metalness:0.05 });
  for(let i=0;i<8;i++){
    const body=new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8),batMat);
    const wingL=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.18,0.6),batMat);
    const wingR=wingL.clone();
    wingL.position.set(-0.12,0,-0.15); wingL.rotation.x=Math.PI/6;
    wingR.position.set(0.12,0,-0.15); wingR.rotation.x=-Math.PI/6;
    const bat=new THREE.Group(); bat.add(body); bat.add(wingL); bat.add(wingR);
    bat.position.set(-8+Math.random()*16,1.2+Math.random()*1.4,-4-Math.random()*12);
    bat.userData={ type:'bat', name:'Cave Bat 🦇', desc:'Bats navigate complete darkness using echolocation — they emit high-frequency sound pulses and interpret the echoes that bounce back from cave walls, insects, and other bats. This allows them to “see” their surroundings with sound, detecting objects thinner than a human hair. In caves, echolocation is far more reliable than vision. The rapid echoes also help bats avoid collisions in dense spaces while hunting insects mid-flight. Their wings are highly flexible membranes, evolved for tight maneuvering rather than speed. Cave bats play a crucial ecological role by controlling insect populations and transporting nutrients into cave systems through guano.'};
    INTERACT_GROUP.add(bat);
  }

  // Olms
  const crawlerMat = new THREE.MeshStandardMaterial({ color:0x3b3b3b, roughness:3.0, metalness:0.05 });
  for(let i=0;i<6;i++){
    const crawler=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,1,12),crawlerMat); body.rotation.x=Math.PI/2;
    const head=new THREE.Mesh(new THREE.SphereGeometry(0.14,8,8),crawlerMat); head.position.set(0,0,0.55);
    crawler.add(body); crawler.add(head);

    // small legs
    const legGeom=new THREE.CylinderGeometry(0.03,0.03,0.3,6);
    [[-0.08,-0.1,0.2],[0.08,-0.1,0.2],[-0.08,-0.1,-0.2],[0.08,-0.1,-0.2]].forEach(pos=>{
      const leg=new THREE.Mesh(legGeom,crawlerMat); leg.position.set(...pos); leg.rotation.z=Math.PI/2; crawler.add(leg);
    });

    crawler.position.set(-6+Math.random()*12,-0.2,-3-Math.random()*10);
    crawler.rotation.y=Math.random()*Math.PI*2;
    crawler.userData={ type:'olm', name:'Olm 🦎 (Proteus anguinus)', desc:'The olm is a troglobitic species — an animal that spends its entire life underground in complete darkness. Over thousands of generations, natural selection favored efficiency over sight, causing olms to lose functional eyes entirely. Instead of vision, olms rely on heightened senses of smell, vibration, and electrical signals to navigate their environment. They have extremely slow metabolisms and can survive for years without food, an adaptation to nutrient-poor cave ecosystems. The olm’s pale skin reflects the absence of sunlight, and its long lifespan makes it one of the most evolutionarily specialized cave vertebrates on Earth.'};
    INTERACT_GROUP.add(crawler);
  }
  // === Bacteria / moss ===
const bacteriaMat = new THREE.MeshStandardMaterial({ 
  color: 0x55aa33, 
  roughness: 0.9, 
  emissive: 0x22ff33, 
  emissiveIntensity: 0.15 
});
for(let i=0; i<20; i++){
  const radius = 0.05 + Math.random()*0.1;
  const height = 0.02 + Math.random()*0.05;
  const geo = new THREE.CylinderGeometry(radius, radius, height, 6);
  deformGeometry(geo, 0.02);
  const moss = new THREE.Mesh(geo, bacteriaMat);
  moss.position.set(-15 + Math.random()*30, -1.05 + Math.random()*0.05, -5 - Math.random()*20);
  moss.rotation.y = Math.random() * Math.PI*2;
  INTERACT_GROUP.add(moss);
  moss.userData = { type:'bacteria', name:'Cave Bacteria 🦠', desc:'Cave bacteria often obtain energy by chemically reacting with minerals rather than using sunlight. This process, called chemolithotrophy, allows life to exist deep underground. These microbes influence cave formation and offer clues about early life on Earth and possible life beyond it.' };
}
}

// === Input / animation ===
function initInput(){
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('click', onClick);
}
function onPointerMove(e){
  pointer.x=(e.clientX/window.innerWidth)*2-1;
  pointer.y=-(e.clientY/window.innerHeight)*2+1;
  const v=new THREE.Vector3(pointer.x,pointer.y,0.5).unproject(camera);
  const dir=v.sub(camera.position).normalize();
  const distance=6.0;
  const targetPoint=camera.position.clone().add(dir.multiplyScalar(distance));
  torch.target.position.lerp(targetPoint,0.6);
  torch.position.lerp(camera.position.clone().add(new THREE.Vector3(0,0.6,0)),0.25);
  torchVisual.position.copy(torch.target.position);
}
function onClick(){
  raycaster.setFromCamera(pointer,camera);
  const intersects=raycaster.intersectObjects(INTERACT_GROUP.children,true);
  if(intersects.length>0){
    let root=intersects[0].object;
    while(root && !root.userData.name){if(!root.parent)break; root=root.parent;}
    const meta=root&&root.userData?root.userData:{name:'Unknown',desc:'No description.'};
    showInfo(meta.name,meta.desc); playEchoSound(); popObject(root);
  } else infoCard.classList.add('hidden');
}
function showInfo(title,text){ infoTitle.textContent=title; infoText.textContent=text; infoCard.classList.remove('hidden'); }
function popObject(obj){ if(!obj) return; const originals=[]; obj.traverse(n=>{if(n.isMesh) originals.push({m:n,s:n.scale.clone()});}); originals.forEach(o=>o.m.scale.multiplyScalar(1.18)); setTimeout(()=>{originals.forEach(o=>o.m.scale.copy(o.s));},260); }

const clock=new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const t=clock.getElapsedTime();
  INTERACT_GROUP.children.forEach(child=>{
    if(child.userData && child.userData.type==='bat'){
      const speed=6+(child.position.x%3);
      const flap=Math.sin(t*speed)*0.35+0.45;
      child.children.forEach((c,i)=>{if(i===1)c.rotation.z=-flap;if(i===2)c.rotation.z=flap;});
      child.position.x+=Math.sin(t*0.6+child.position.z)*0.02;
      child.position.y=1.5+Math.sin(t*1.2+child.position.x)*0.5;
      child.position.z+=Math.cos(t*0.5+child.position.x)*0.02;
      child.rotation.y+=0.01;
    }
    if(child.userData && child.userData.type==='olm'){
      const speed=0.6+(child.position.x%2)*0.05;
            child.position.x+=Math.sin(t*speed+child.position.z)*0.02;
      child.position.z+=Math.cos(t*speed+child.position.x)*0.02;
      child.position.y=-0.2+Math.sin(t*2+child.position.x)*0.05;
      child.children.forEach(c=>{if(c.geometry.type==='SphereGeometry')c.rotation.y=Math.sin(t*1.5)*0.2;});
      if(child.position.x>12) child.position.x=-12;
      if(child.position.x<-12) child.position.x=12;
      if(child.position.z>0) child.position.z=-12;
      if(child.position.z<-12) child.position.z=0;
    }
    if(child.userData && (child.userData.type==='mineral' || child.userData.type==='fungi')){
      const pulse=0.12+Math.abs(Math.sin(t*0.6+child.position.x))*0.08;
      if(child.material && child.material.emissive) child.material.emissiveIntensity=pulse;
      child.traverse(n=>{if(n.material && n.material.emissive) n.material.emissiveIntensity=pulse;});
    }
  });

  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(INTERACT_GROUP.children,true);
  INTERACT_GROUP.children.forEach(c=>setHighlight(c,false));
  if(hits.length>0){
    let root=hits[0].object;
    while(root && !root.userData.name){if(!root.parent)break; root=root.parent;}
    if(root) setHighlight(root,true);
  }

  camera.position.x=Math.sin(clock.getElapsedTime()*0.05)*0.06;
  camera.lookAt(0,0.6,-6);
  renderer.render(scene,camera);
}

function setHighlight(obj,enable){
  obj.traverse(n=>{
    if(n.isMesh){
      if(!n.userData._orig) n.userData._orig={em:n.material.emissive? n.material.emissive.clone():new THREE.Color(0x000000)};
      if(enable){ 
        if(n.material.emissive) n.material.emissive.lerp(new THREE.Color(0x222222),0.25); 
        else n.material.emissive=new THREE.Color(0x222222); 
        n.scale.lerp(new THREE.Vector3(1.08,1.08,1.08),0.1);
      }
      else { 
        if(n.material.emissive && n.userData._orig.em) n.material.emissive.lerp(n.userData._orig.em,0.08); 
        n.scale.lerp(new THREE.Vector3(1,1,1),0.08);
      }
    }
  });
}

function onWindowResize(){ 
  if(!camera||!renderer) return; 
  camera.aspect=window.innerWidth/window.innerHeight; 
  camera.updateProjectionMatrix(); 
  renderer.setSize(window.innerWidth,window.innerHeight); 
}
