/**
 * Public didactic presets for MRY Visual Studio (SPN & RBD in Mercury syntax).
 * All models are self-contained educational examples covering core Mercury features:
 * - SPN: places, exponential/deterministic/immediate transitions, guards, inhibitors,
 *   marking-dependent IF(...):(...)ELSE(...) arc weights, serverType, metrics.
 * - RBD: exponential blocks (MTTF/MTTR), hierarchy blocks, series, parallel, kooN.
 */
(function (root) {
  "use strict";

  const PRESETS = [
    {
      id: "spn_client_server_timeout",
      name: "SPN — Cliente-Servidor com Timeout Determinístico & IF(...)",
      code: `initialClients = 8;
initialServers = 1;
meanArrivalDelay = 2.0;
meanNetworkDelay = 0.08;
meanServiceTime = 0.15;
requestTimeout = 1.0;

SPN ClientServerTimeout {
    place Idle( tokens = initialClients );
    place Arriving;
    place WaitingServer;
    place InService;
    place DeadlinePending;
    place TimedOut;
    place AckReady;
    place ServerFree( tokens = initialServers );
    place ServerBusy;

    timedTransition GenerateRequest(
        inputs = [Idle],
        outputs = [Arriving],
        delay = meanArrivalDelay
    );

    timedTransition SendRequest(
        inputs = [Arriving],
        outputs = [WaitingServer, DeadlinePending],
        delay = meanNetworkDelay,
        serverType = "InfiniteServer"
    );

    immediateTransition AcquireServer(
        inputs = [WaitingServer, ServerFree],
        outputs = [InService, ServerBusy]
    );

    timedTransition ProcessRequest(
        inputs = [ServerBusy],
        outputs = [
            AckReady("IF(#DeadlinePending>0):(#InService)ELSE(0)")
        ],
        delay = meanServiceTime,
        serverType = "InfiniteServer"
    );

    immediateTransition ReceiveAck(
        inputs = [AckReady, InService, DeadlinePending],
        outputs = [Idle, ServerFree]
    );

    timedTransition RequestTimeout(
        inputs = [DeadlinePending],
        outputs = [TimedOut],
        delay = ( type = "Deterministic", parameters = ( Value = requestTimeout ) ),
        serverType = "InfiniteServer"
    );

    immediateTransition RecycleTimeout(
        inputs = [
            TimedOut,
            WaitingServer("IF(#InService=0 AND #WaitingServer>0):(1)ELSE(0)"),
            InService("IF(#InService>0):(1)ELSE(0)"),
            ServerBusy("IF(#InService>0):(1)ELSE(0)")
        ],
        outputs = [
            Idle,
            ServerFree("IF(#InService>0):(1)ELSE(0)")
        ]
    );

    metric serverUtilization = stationarySimulation(expression="P{#ServerBusy>0}");
    metric meanQueueLength = stationarySimulation(expression="E{#WaitingServer}");
}

main {
    util = solve(ClientServerTimeout, serverUtilization);
    println(util);
}
`
    },
    {
      id: "spn_ha_guard_inhibitor",
      name: "SPN — Disponibilidade com Guarda, Prioridade e Inibidor ○",
      code: `mttfPrimary = 720.0;
mttrPrimary = 2.0;
mttfBackup = 1000.0;
mttrBackup = 4.0;
failoverTime = 0.05;

SPN HighAvailabilityPair {
    place Primary_Up( tokens = 1 );
    place Primary_Down;
    place Backup_Up( tokens = 1 );
    place Backup_Down;
    place Backup_Active;

    timedTransition FailPrimary(
        inputs = [Primary_Up],
        outputs = [Primary_Down],
        delay = mttfPrimary
    );

    timedTransition RepairPrimary(
        inputs = [Primary_Down],
        outputs = [Primary_Up],
        delay = mttrPrimary
    );

    timedTransition FailBackup(
        inputs = [Backup_Up],
        outputs = [Backup_Down],
        delay = mttfBackup
    );

    timedTransition RepairBackup(
        inputs = [Backup_Down],
        outputs = [Backup_Up],
        delay = mttrBackup
    );

    timedTransition ActivateBackup(
        inputs = [Backup_Up],
        outputs = [Backup_Active],
        inhibitors = [Primary_Up],
        enablingFunction = "(#Primary_Down=1)AND(#Backup_Active=0)",
        delay = failoverTime
    );

    immediateTransition RestorePrimary(
        inputs = [Backup_Active],
        outputs = [Backup_Up],
        enablingFunction = "(#Primary_Up=1)",
        priority = 2,
        weight = 1.0
    );

    metric sysAvailability = stationaryAnalysis(expression="P{(#Primary_Up=1)OR(#Backup_Active=1)}");
}

main {
    av = solve(HighAvailabilityPair, sysAvailability);
    println(av);
}
`
    },
    {
      id: "rbd_web_architecture",
      name: "RBD — Arquitetura Web (Série + Paralelo + Hierárquico)",
      code: `mttfCloud = 8760.0;
mttrCloud = 1.0;
mttfRouter = 4380.0;
mttrRouter = 2.0;
mttfServer = 2190.0;
mttrServer = 4.0;
rNetworkLink = 0.995;
missionHours = 24.0;

RBD WebArchitecture {
    block Cloud(MTTF = mttfCloud, MTTR = mttrCloud);
    block Router(MTTF = mttfRouter, MTTR = mttrRouter);
    hierarchy NetLink(availability = rNetworkLink, reliability = rNetworkLink);
    block AppSrv1(MTTF = mttfServer, MTTR = mttrServer);
    block AppSrv2(MTTF = mttfServer, MTTR = mttrServer);

    parallel AppTier(AppSrv1, AppSrv2);
    series SystemTop(Cloud, Router, NetLink, AppTier);

    top SystemTop;

    metric av = availability;
    metric rel24h = reliability(time = missionHours);
}

main {
    println(solve(WebArchitecture, av));
    println(solve(WebArchitecture, rel24h));
}
`
    },
    {
      id: "rbd_cluster_koon",
      name: "RBD — Cluster Redundante 2-de-3 (kooN) com Energia Dual",
      code: `mttfPower = 5000.0;
mttrPower = 2.0;
mttfSwitch = 6000.0;
mttrSwitch = 1.5;
mttfNode = 1500.0;
mttrNode = 4.0;
missionHours = 12.0;

RBD RedundantCluster {
    block PSU_A(MTTF = mttfPower, MTTR = mttrPower);
    block PSU_B(MTTF = mttfPower, MTTR = mttrPower);
    block CoreSwitch(MTTF = mttfSwitch, MTTR = mttrSwitch);
    block Node_1(MTTF = mttfNode, MTTR = mttrNode);
    block Node_2(MTTF = mttfNode, MTTR = mttrNode);
    block Node_3(MTTF = mttfNode, MTTR = mttrNode);

    parallel PowerDual(PSU_A, PSU_B);
    kooN Compute2of3(k = 2, Node_1, Node_2, Node_3);
    series ClusterTop(PowerDual, CoreSwitch, Compute2of3);

    top ClusterTop;

    metric av = availability;
    metric rel12h = reliability(time = missionHours);
}

main {
    println(solve(RedundantCluster, av));
    println(solve(RedundantCluster, rel12h));
}
`
    }
  ];

  root.MRY_PRESETS = PRESETS;
})(typeof window !== "undefined" ? window : globalThis);
