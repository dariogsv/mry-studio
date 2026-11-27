/**
 * Classic textbook presets for MRY Visual Studio (Dependability & Performance literature).
 * Self-contained educational models covering core Mercury SPN and RBD features:
 * 1. M/M/1/K finite-capacity queue (Queueing Theory)
 * 2. Cold-standby redundancy with single repairman (Classical Dependability)
 * 3. Industrial series-parallel pumping unit (RBD)
 * 4. Triple Modular Redundancy (TMR 2-of-3 + Voter) (Fault-Tolerant Systems)
 */
(function (root) {
  "use strict";

  const PRESETS = [
    {
      id: "spn_mm1k_queue",
      name: "SPN — Fila M/M/1/K Clássica (Capacidade Finita)",
      code: `bufferCapacity = 5;
arrivalDelay = 1.5;
serviceDelay = 1.0;

SPN QueueMM1K {
    place FreeSlots( tokens = bufferCapacity );
    place Waiting;
    place ServerIdle( tokens = 1 );
    place ServerBusy;

    timedTransition Arrival(
        inputs = [FreeSlots],
        outputs = [Waiting],
        delay = arrivalDelay
    );

    immediateTransition StartService(
        inputs = [Waiting, ServerIdle],
        outputs = [ServerBusy]
    );

    timedTransition FinishService(
        inputs = [ServerBusy],
        outputs = [ServerIdle, FreeSlots],
        delay = serviceDelay
    );

    metric utilization = stationaryAnalysis(expression="P{#ServerBusy>0}");
    metric meanQueue = stationaryAnalysis(expression="E{#Waiting}");
    metric blockingProb = stationaryAnalysis(expression="P{#FreeSlots=0}");
}

main {
    println(solve(QueueMM1K, utilization));
    println(solve(QueueMM1K, meanQueue));
    println(solve(QueueMM1K, blockingProb));
}
`
    },
    {
      id: "spn_cold_standby",
      name: "SPN — Redundância Cold Standby com Reparo (Inibidor + IF)",
      code: `mttfUnit = 1000.0;
mttrUnit = 8.0;
switchoverDelay = 0.05;

SPN ColdStandbySystem {
    place Active_Up( tokens = 1 );
    place Standby_Up( tokens = 1 );
    place Failed;
    place Repairman_Free( tokens = 1 );

    timedTransition FailActive(
        inputs = [Active_Up],
        outputs = [Failed],
        delay = mttfUnit
    );

    timedTransition Switchover(
        inputs = [Standby_Up],
        outputs = [Active_Up],
        inhibitors = [Active_Up],
        delay = ( type = "Deterministic", parameters = ( Value = switchoverDelay ) )
    );

    timedTransition RepairUnit(
        inputs = [Failed, Repairman_Free],
        outputs = [
            Repairman_Free,
            Active_Up(" IF(#Active_Up=0):(1)ELSE(0)"),
            Standby_Up(" IF(#Active_Up>0):(1)ELSE(0)")
        ],
        guardExpression = (#Failed > 0),
        delay = mttrUnit
    );

    metric availability = stationarySimulation(expression="P{#Active_Up>0}");
    metric fullRedundancy = stationarySimulation(expression="P{(#Active_Up=1)AND(#Standby_Up=1)}");
}

main {
    println(solve(ColdStandbySystem, availability));
    println(solve(ColdStandbySystem, fullRedundancy));
}
`
    },
    {
      id: "rbd_industrial_pumping",
      name: "RBD — Sistema Industrial Série-Paralelo (Energia + Bombas + PLC)",
      code: `mttfPower = 8760.0;
mttrPower = 2.0;
mttfPump = 2500.0;
mttrPump = 12.0;
mttfValve = 6000.0;
mttrValve = 4.0;
mttfPlc = 12000.0;
mttrPlc = 1.5;
missionHours = 100.0;

RBD IndustrialPumpingUnit {
    block PowerGrid(MTTF = mttfPower, MTTR = mttrPower);
    block Pump_A(MTTF = mttfPump, MTTR = mttrPump);
    block Pump_B(MTTF = mttfPump, MTTR = mttrPump);
    block ControlValve(MTTF = mttfValve, MTTR = mttrValve);
    block PLC(MTTF = mttfPlc, MTTR = mttrPlc);

    parallel DualPumps(Pump_A, Pump_B);
    series SystemTop(PowerGrid, DualPumps, ControlValve, PLC);

    top SystemTop;

    metric av = availability;
    metric rel100h = reliability(time = missionHours);
}

main {
    println(solve(IndustrialPumpingUnit, av));
    println(solve(IndustrialPumpingUnit, rel100h));
}
`
    },
    {
      id: "rbd_tmr_voting",
      name: "RBD — Votação Tripla Modular — TMR 2-de-3 + Voter (Aviónica)",
      code: `mttfCpu = 4000.0;
mttrCpu = 6.0;
rVoter = 0.9995;
missionHours = 48.0;

RBD TripleModularRedundancy {
    block CPU_1(MTTF = mttfCpu, MTTR = mttrCpu);
    block CPU_2(MTTF = mttfCpu, MTTR = mttrCpu);
    block CPU_3(MTTF = mttfCpu, MTTR = mttrCpu);
    hierarchy Voter(availability = rVoter, reliability = rVoter);

    kooN Channels_2of3(k = 2, CPU_1, CPU_2, CPU_3);
    series TMR_System(Channels_2of3, Voter);

    top TMR_System;

    metric av = availability;
    metric rel48h = reliability(time = missionHours);
}

main {
    println(solve(TripleModularRedundancy, av));
    println(solve(TripleModularRedundancy, rel48h));
}
`
    }
  ];

  root.MRY_PRESETS = PRESETS;
})(typeof window !== "undefined" ? window : globalThis);
