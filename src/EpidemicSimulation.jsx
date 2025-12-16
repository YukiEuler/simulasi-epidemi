import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Activity, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush } from 'recharts';

const EpidemicSimulation = () => {
  const canvasRef = useRef(null);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  
  // Parameters
  const [populationSize, setPopulationSize] = useState(200);
  const [infectionRate, setInfectionRate] = useState(0.3);
  const [recoveryTime, setRecoveryTime] = useState(5000);
  const [mobilityRate, setMobilityRate] = useState(0.5);
  const [initialInfected, setInitialInfected] = useState(3);
  const [quarantineDelay, setQuarantineDelay] = useState(3000); // ms after infection
  const [maskEnabled, setMaskEnabled] = useState(false); // NPI: masks reduce transmission
  const [healthcareCapacity, setHealthcareCapacity] = useState(30); // active cases capacity threshold
  const [vaccinationRate, setVaccinationRate] = useState(0); // persons per second
  const [immunityDuration, setImmunityDuration] = useState(15000); // ms before waning
  
  const [stats, setStats] = useState({
    healthy: 0,
    infected: 0,
    recovered: 0,
    dead: 0,
    r0Value: 0,  // R₀ from initial infections
    rtValue: 0   // R_t current average
  });

  const [chartData, setChartData] = useState([]);
  const [rtData, setRtData] = useState([]);

  const simulationRef = useRef({
    people: [],
    time: 0,
    infections: []
  });

  // Initialize population
  const initializeSimulation = () => {
    const canvas = canvasRef.current;
    // Ensure simulation and chart initialize even if canvas isn't ready yet
    const people = [];
    const w = canvas?.width || 700;
    const h = canvas?.height || 500;

    for (let i = 0; i < populationSize; i++) {
      people.push({
        id: i,
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        status: i < initialInfected ? 'infected' : 'healthy',
        infectedTime: i < initialInfected ? 0 : null,
        ageGroup: (() => { const r = Math.random(); if (r < 0.25) return 'child'; if (r < 0.8) return 'adult'; return 'senior'; })(),
        exposedTime: null,
        incubationPeriod: 1000 + Math.random() * 2000, // 1-3s
        asymptomatic: false,
        infectionRadius: 8 + Math.random() * 4, // 8-12 px
        personalRecovery: recoveryTime * (0.7 + Math.random() * 0.6), // 0.7x - 1.3x
        oldRecoveryTime: recoveryTime, // Track previous recovery time for updates
        immunityEndTime: null,
        infectedBy: null,
        infectionsSpread: 0
      });
    }

    simulationRef.current = {
      people,
      time: 0,
      infections: []
    };

    // Seed initial chart point so the graph is visible immediately
    setChartData([{
      time: 0,
      Sehat: populationSize - initialInfected,
      Terinfeksi: initialInfected,
      Sembuh: 0,
      Meninggal: 0
    }]);
  };

  // Update simulation parameters without changing positions
  const updateSimulationParameters = () => {
    const sim = simulationRef.current;
    if (sim.people.length === 0) return;

    sim.people.forEach(person => {
      // Update personal recovery time based on current recoveryTime parameter
      // The original personalRecovery was: recoveryTime * (0.7 + Math.random() * 0.6)
      // Which means it ranges from recoveryTime * 0.7 to recoveryTime * 1.3
      // Extract the multiplier (0.7 to 1.3) by dividing by the old recoveryTime
      
      // Get the multiplier from the stored recovery time
      if (person.oldRecoveryTime && person.oldRecoveryTime > 0) {
        const multiplier = person.personalRecovery / person.oldRecoveryTime;
        person.personalRecovery = recoveryTime * multiplier;
      } else {
        // Fallback: assume it's between 0.7 and 1.3
        const multiplier = person.personalRecovery / 5000; // assuming default was around 5000
        person.personalRecovery = recoveryTime * multiplier;
      }
      
      person.oldRecoveryTime = recoveryTime; // Store for next update
    });
  };

  useEffect(() => {
    initializeSimulation();
  }, [populationSize, initialInfected]);

  // Update parameters when simulation is running without reinitializing
  useEffect(() => {
    if (simulationRef.current.people.length > 0) {
      updateSimulationParameters();
    }
  }, [recoveryTime, immunityDuration, quarantineDelay]);

  // Monte Carlo: Check if infection occurs
  const attemptInfection = (person1, person2) => {
    // Quarantined individuals neither infect nor get infected
    if (person1.status === 'quarantined' || person2.status === 'quarantined') return false;
    const infectious = person1.status === 'infected' || (person1.status === 'asymptomatic');
    if (infectious && person2.status === 'healthy') {
      const maskFactor = maskEnabled ? 0.5 : 1; // masks halve transmission
      const asympFactor = person1.status === 'asymptomatic' ? 0.5 : 1; // asymptomatic less infectious
      const effectiveRate = infectionRate * maskFactor * asympFactor;
      if (Math.random() < effectiveRate) {
        person2.status = 'exposed';
        person2.exposedTime = simulationRef.current.time;
        person2.status = 'infected';
        person2.infectedTime = simulationRef.current.time;
        person2.infectedBy = person1.id;
        person1.infectionsSpread++;
        simulationRef.current.infections.push({
          from: person1.id,
          to: person2.id,
          time: simulationRef.current.time
        });
        return true;
      }
    }
    return false;
  };

  // Monte Carlo: Determine outcome (recovery or death)
  const determineOutcome = (person, overCapacity) => {
    const baseMortality = person.ageGroup === 'child' ? 0.2 : person.ageGroup === 'adult' ? 0.05 : 0.2;
    const mortalityRate = baseMortality * (overCapacity ? 1.5 : 1.0);
    if (Math.random() < mortalityRate) {
      person.status = 'dead';
      person.vx = 0;
      person.vy = 0;
    } else {
      person.status = 'recovered';
      person.immunityEndTime = simulationRef.current.time + (person.immunityDurationRef || immunityDuration);
    }
  };

  const updateSimulation = () => {
    const sim = simulationRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = canvas.width;
    const h = canvas.height;
    const deltaTime = 16 * speed;
    sim.time += deltaTime;

    const people = sim.people;

    // Update each person
    people.forEach(person => {
      if (person.status === 'dead') return;
      // Quarantined individuals do not move
      const isQuarantined = person.status === 'quarantined';

      // Movement with Monte Carlo random walk scaled by mobilityRate
      if (!isQuarantined && mobilityRate > 0 && Math.random() < mobilityRate) {
        const accelScale = mobilityRate; // scale acceleration by mobility
        person.vx += (Math.random() - 0.5) * 0.5 * accelScale;
        person.vy += (Math.random() - 0.5) * 0.5 * accelScale;

        // Limit velocity: max speed proportional to mobility (keep small baseline)
        const maxSpeed = 0.2 + 1.8 * mobilityRate; // 0.2 at 0, ~2 at 1
        const currentSpeed = Math.sqrt(person.vx ** 2 + person.vy ** 2);
        if (currentSpeed > maxSpeed) {
          person.vx = (person.vx / currentSpeed) * maxSpeed;
          person.vy = (person.vy / currentSpeed) * maxSpeed;
        }
      }

      // Position update scaled by mobility: 0 => stop, 1 => normal
      if (!isQuarantined) {
        person.x += person.vx * mobilityRate;
        person.y += person.vy * mobilityRate;
      }

      // Boundary collision
      if (person.x < 5 || person.x > w - 5) {
        person.vx *= -1;
        person.x = Math.max(5, Math.min(w - 5, person.x));
      }
      if (person.y < 5 || person.y > h - 5) {
        person.vy *= -1;
        person.y = Math.max(5, Math.min(h - 5, person.y));
      }

      // Progress exposed -> infectious (infected or asymptomatic)
      if (person.status === 'exposed' && sim.time - person.exposedTime > person.incubationPeriod) {
        person.asymptomatic = Math.random() < 0.4; // 40% asymptomatic
        person.status = person.asymptomatic ? 'asymptomatic' : 'infected';
        person.infectedTime = sim.time;
      }

      // Move infected to quarantined after delay
      if (person.status === 'infected' && sim.time - person.infectedTime > (person.quarantineDelayRef || quarantineDelay)) {
        person.status = 'quarantined';
        // Reduce movement immediately
        person.vx = 0;
        person.vy = 0;
      }

      // Check recovery
      const isInfectiousState = person.status === 'infected' || person.status === 'quarantined' || person.status === 'asymptomatic';
      if (isInfectiousState && sim.time - person.infectedTime > person.personalRecovery) {
        determineOutcome(person);
      }
    });

    // Check collisions and infections
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const p1 = people[i];
        const p2 = people[j];
        
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 10) {
          // Collision response
          const angle = Math.atan2(dy, dx);
          const sin = Math.sin(angle);
          const cos = Math.cos(angle);
          
          // Separate particles
          const overlap = 10 - distance;
          p1.x += cos * overlap / 2;
          p1.y += sin * overlap / 2;
          p2.x -= cos * overlap / 2;
          p2.y -= sin * overlap / 2;
          
          // Monte Carlo: Attempt infection
          attemptInfection(p1, p2);
          attemptInfection(p2, p1);
        }
      }
    }

    // Update statistics
    let healthy = 0, exposed = 0, asymptomatic = 0, infected = 0, quarantined = 0, recovered = 0, dead = 0;
    people.forEach(p => {
      if (p.status === 'healthy') healthy++;
      else if (p.status === 'exposed') exposed++;
      else if (p.status === 'asymptomatic') asymptomatic++;
      else if (p.status === 'infected') infected++;
      else if (p.status === 'quarantined') quarantined++;
      else if (p.status === 'recovered') recovered++;
      else if (p.status === 'dead') dead++;
    });

    // Calculate R₀ (only from initial infected individuals)
    let r0Value = 0;
    const initialInfections = people.filter(p => 
      p.id < initialInfected && // only initial infected
      p.infectedTime !== null &&
      (p.status === 'recovered' || p.status === 'dead')
    );
    
    if (initialInfections.length > 0) {
      const totalInitialSpread = initialInfections.reduce((sum, p) => sum + p.infectionsSpread, 0);
      r0Value = (totalInitialSpread / initialInfections.length).toFixed(2);
    }

    // Calculate R_t (all completed infections)
    const completedInfections = people.filter(p => 
      p.infectedTime !== null &&
      (p.status === 'recovered' || p.status === 'dead')
    );
    
    let rtValue = 0;
    if (completedInfections.length > 0) {
      const totalInfectionsSpread = completedInfections.reduce((sum, p) => sum + p.infectionsSpread, 0);
      rtValue = (totalInfectionsSpread / completedInfections.length).toFixed(2);
    }

    setStats({ healthy, infected: infected + quarantined, recovered, dead, r0Value, rtValue });

    // Update chart every 500ms
    if (sim.time % 500 < deltaTime) {
      setChartData(prev => [...prev, {
        time: (sim.time / 1000).toFixed(1),
        Sehat: healthy,
        Terpapar: exposed,
        Asimtomatik: asymptomatic,
        Terinfeksi: infected,
        Sembuh: recovered,
        Meninggal: dead
      }]); // Keep all data points for historical view
      
      // Track R_t over time
      if (completedInfections.length > 0) {
        setRtData(prev => [...prev, {
          time: (sim.time / 1000).toFixed(1),
          Rt: parseFloat(rtValue),
          R0: parseFloat(r0Value) || 0,
          Threshold: 1
        }]);
      }
    }
  };

  const drawSimulation = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const people = simulationRef.current.people;

    // Clear with background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Draw grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
    }
    for (let i = 0; i < h; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(w, i);
      ctx.stroke();
    }

    // Draw people
    people.forEach(person => {
      ctx.beginPath();
      ctx.arc(person.x, person.y, 5, 0, Math.PI * 2);
      
      switch(person.status) {
        case 'healthy':
          ctx.fillStyle = '#22c55e';
          break;
        case 'exposed':
          ctx.fillStyle = '#f59e0b'; // orange
          break;
        case 'infected':
          ctx.fillStyle = '#ef4444';
          // Pulsing effect for infected
          const pulse = Math.sin(simulationRef.current.time / 200) * 0.3 + 1;
          ctx.arc(person.x, person.y, 5 * pulse, 0, Math.PI * 2);
          break;
        case 'asymptomatic':
          ctx.fillStyle = '#fb7185'; // rose
          break;
        case 'quarantined':
          ctx.fillStyle = '#eab308'; // amber
          break;
        case 'recovered':
          ctx.fillStyle = '#3b82f6';
          break;
        case 'dead':
          ctx.fillStyle = '#64748b';
          break;
      }
      
      ctx.fill();
      
      // Draw outline
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Draw infection radius for infectious people (infected/asymptomatic)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.lineWidth = 1;
    people.forEach(person => {
      if (person.status === 'infected' || person.status === 'asymptomatic') {
        ctx.beginPath();
        ctx.arc(person.x, person.y, person.infectionRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  };

  useEffect(() => {
    let animationId;
    
    const animate = () => {
      if (isRunning) {
        updateSimulation();
        drawSimulation();
      } else {
        drawSimulation();
      }
      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationId);
  }, [isRunning, speed, infectionRate, recoveryTime, mobilityRate]);

  const resetSimulation = () => {
    setIsRunning(false);
    setRtData([]); // Clear R_t data
    initializeSimulation();
    drawSimulation();
  };

  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-center bg-gradient-to-r from-red-400 to-blue-400 bg-clip-text text-transparent">
          🦠 Simulasi Monte Carlo - Penyebaran Penyakit
        </h1>
        <p className="text-gray-400 text-center mb-4">
          Model SIR (Susceptible-Infected-Recovered) dengan metode Monte Carlo
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Left Panel - Canvas */}
          <div className="xl:col-span-2 space-y-4">
            <div className="bg-slate-800 rounded-lg p-4 shadow-2xl">
              <canvas
                ref={canvasRef}
                width={700}
                height={500}
                className="w-full border-2 border-slate-700 rounded"
              />
            </div>

            {/* Chart */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-2xl">
              <h3 className="text-lg font-semibold mb-3 flex items-center">
                <TrendingUp className="w-5 h-5 mr-2" />
                Grafik Penyebaran
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" label={{ value: 'Waktu (detik)', position: 'insideBottom', offset: -5 }} />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="Sehat" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
                  {/* <Line type="monotone" dataKey="Terpapar" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} /> */}
                  <Line type="monotone" dataKey="Asimtomatik" stroke="#fb7185" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Terinfeksi" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Sembuh" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Meninggal" stroke="#64748b" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Brush dataKey="time" height={30} stroke="#64748b" fill="#1e293b" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* R_t Chart */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-2xl">
              <h3 className="text-lg font-semibold mb-3 flex items-center">
                📈 Grafik Reproduction Number
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={rtData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" label={{ value: 'Waktu (detik)', position: 'insideBottom', offset: -5 }} />
                  <YAxis stroke="#94a3b8" domain={[0, 'auto']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="R0" stroke="#a855f7" strokeWidth={3} dot={false} isAnimationActive={false} name="R₀ (Initial)" strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="Rt" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} name="R_t (Current)" />
                  <Line type="monotone" dataKey="Threshold" stroke="#64748b" strokeWidth={1} dot={false} isAnimationActive={false} name="R=1 (Threshold)" strokeDasharray="3 3" />
                  <Brush dataKey="time" height={30} stroke="#64748b" fill="#1e293b" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right Panel - Controls */}
          <div className="space-y-4">
            {/* Control Buttons */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-2xl">
              <h3 className="text-lg font-semibold mb-3 flex items-center">
                <Activity className="w-5 h-5 mr-2" />
                Kontrol
              </h3>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setIsRunning(!isRunning)}
                  className={`flex-1 py-2 px-4 rounded font-semibold flex items-center justify-center gap-2 transition ${
                    isRunning 
                      ? 'bg-red-600 hover:bg-red-700' 
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isRunning ? 'Pause' : 'Start'}
                </button>
                <button
                  onClick={resetSimulation}
                  className="py-2 px-4 bg-slate-600 hover:bg-slate-700 rounded font-semibold flex items-center gap-2 transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">
                    Kecepatan: {speed}x
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.5"
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="w-full"
                    disabled={isRunning}
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Populasi: {populationSize}
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="1000"
                    step="50"
                    value={populationSize}
                    onChange={(e) => setPopulationSize(parseInt(e.target.value))}
                    className="w-full"
                    disabled={isRunning}
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Tingkat Infeksi: {(infectionRate * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="0.8"
                    step="0.1"
                    value={infectionRate}
                    onChange={(e) => setInfectionRate(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Waktu Pemulihan: {(recoveryTime / 1000).toFixed(1)}s
                  </label>
                  <input
                    type="range"
                    min="2000"
                    max="20000"
                    step="1000"
                    value={recoveryTime}
                    onChange={(e) => setRecoveryTime(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Mobilitas: {(mobilityRate * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={mobilityRate}
                    onChange={(e) => setMobilityRate(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="block text-sm mb-1">Masker (kurangi transmisi)</label>
                  <input
                    type="checkbox"
                    checked={maskEnabled}
                    onChange={(e) => setMaskEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Karantina setelah infeksi: {(quarantineDelay / 1000).toFixed(1)}s
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="25000"
                    step="500"
                    value={quarantineDelay}
                    onChange={(e) => setQuarantineDelay(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Terinfeksi Awal: {initialInfected}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={initialInfected}
                    onChange={(e) => setInitialInfected(parseInt(e.target.value))}
                    className="w-full"
                    disabled={isRunning}
                  />
                </div>
              </div>
            </div>

            {/* Statistics */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-2xl">
              <h3 className="text-lg font-semibold mb-3">📊 Statistik Real-time</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-green-900/30 p-2 rounded">
                  <span className="text-sm">🟢 Sehat</span>
                  <span className="font-bold">{stats.healthy}</span>
                </div>
                <div className="flex justify-between items-center bg-red-900/30 p-2 rounded">
                  <span className="text-sm">🔴 Terinfeksi</span>
                  <span className="font-bold">{stats.infected}</span>
                </div>
                <div className="flex justify-between items-center bg-blue-900/30 p-2 rounded">
                  <span className="text-sm">🔵 Sembuh</span>
                  <span className="font-bold">{stats.recovered}</span>
                </div>
                <div className="flex justify-between items-center bg-gray-700/30 p-2 rounded">
                  <span className="text-sm">⚫ Meninggal</span>
                  <span className="font-bold">{stats.dead}</span>
                </div>
                <div className="flex justify-between items-center bg-purple-900/30 p-2 rounded border-2 border-purple-500">
                  <span className="text-sm font-semibold">R₀ (Initial)</span>
                  <span className="font-bold text-lg">{stats.r0Value || '...'}</span>
                </div>
                <div className="flex justify-between items-center bg-amber-900/30 p-2 rounded border-2 border-amber-500">
                  <span className="text-sm font-semibold">R_t (Current)</span>
                  <span className="font-bold text-lg">{stats.rtValue}</span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-2xl">
              <h3 className="text-sm font-semibold mb-2">ℹ️ Informasi</h3>
              <p className="text-xs text-gray-300 leading-relaxed">
                <strong>R₀ (Basic Reproduction Number)</strong>: Rata-rata penyebaran dari infeksi <strong>awal</strong> (patient zero).
                <br/><br/>
                <strong>R_t (Effective Reproduction Number)</strong>: Rata-rata penyebaran <strong>saat ini</strong> dari semua kasus yang sudah selesai.
                <br/><br/>
                • R {'<'} 1: Epidemi akan mereda
                <br/>
                • R = 1: Stabil
                <br/>
                • R {'>'} 1: Epidemi akan menyebar
                <br/><br/>
                R_t biasanya menurun seiring waktu karena berkurangnya populasi yang rentan (susceptible).
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 bg-slate-800 rounded-lg p-3 shadow-2xl">
          <p className="text-xs text-gray-400">
            💡 <strong>Tips:</strong> Coba ubah tingkat infeksi dan mobilitas untuk melihat bagaimana parameter mempengaruhi penyebaran penyakit. 
            Perhatikan perbedaan R₀ (konstan dari patient zero) dan R_t (berubah seiring waktu) untuk memahami dinamika epidemi!
          </p>
        </div>
      </div>
    </div>
  );
};

export default EpidemicSimulation;