# 코드 색인(codegraph) 사용

이 머신에는 codegraph 가 설치되어 있다. 코드를 이해할 때 다음처럼 나눠 쓴다.

1. 흐름·호출처·변경 영향은 codegraph 로 본다(`codegraph_explore`, `codegraph_callers`, `codegraph_impact`). 워크트리에서는 `projectPath` 에 그 워크트리 경로를 넘긴다.
2. 정확한 줄 번호와 문자열은 grep 으로 확인한다. 줄 번호가 필요해서 다시 읽는 것은 정상이다.
3. Vue `watch` 콜백 안의 호출과 배열로 등록하는 라우트는 그래프에서 빠질 수 있다. 이런 곳은 grep 으로 한 번 더 확인한다.
4. 「색인 없음(not initialized)」 응답을 받으면 같은 경로로 다시 부르지 않는다. 색인은 대기열에서 만들어지고(`lanekeeper-index status`), 그동안은 grep 과 Read 로 진행한다.
