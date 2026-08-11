---
title: "Sobre os dados do 72 Horas"
date: 2020-10-22T00:00:00.000Z
draft: false
source: "https://plataforma-72horas.medium.com/sobre-os-dados-do-72-horas-ae929bd460e6"
---

Uma das políticas que adotamos na Plataforma 72 Horas é a transparência no
nosso processo de coleta de dados. Por isso, deixamos aqui perguntas
frequentes e nosso contato para quem quiser entender ou saber mais:
plataforma.72horas@gmail.com

## Qual a origem dos dados apresentados na plataforma 72 horas?

Todos os dados exibidos na plataforma 72 horas são coletados na base de
dados do TSE, por meio do repositório e API do portal Divulgacand.

## Quais os dados que a plataforma 72 horas coleta do Divulgacand?

Id da candidatura, Nome, CNPJ da campanha, Município, Cargo, Partido,
Gênero, Raça, Grau de escolaridade, Foto, Porcentagem de recebimento de
repasses de outros candidatos.

## Quais os parâmetros utilizados pra coleta de dados do 72 horas do banco de dados do Divulgacand?

Nossa observação está centrada na declaração de receitas dos candidatos, ou
seja, consumimos aquilo que as candidaturas declaram em suas prestações de
contas que, por lei, devem ocorrer com o prazo de 72 horas.

## Qual a metodologia de coleta de dados e dados que serão analisados?

Os dados são coletados através da API RESTful da plataforma DivulgaCand.
Todos os candidatos de todos os municípios do Brasil são verificados, a
cada execução do crawler. Coletamos as seguintes propriedades de todas as
candidaturas: Id da candidatura, Nome, CNPJ da campanha, Município, Cargo,
Partido, Gênero, Raça, Grau de escolaridade, Foto e Porcentagem de
recebimento de repasses de outros candidatos. Ao cruzar essas informações,
facilitamos a visualização atualizada em tempo e de acordo com a
atualização do TSE, da distribuição destes recursos entre todas as
candidaturas com recortes por gênero, etnia, partido, cidade, origem do
fundo e o tempo em que ela ocorre.

## Quais dados do Divulgacand ficam salvos no banco de dados da plataforma 72 Horas?

Apenas os repasses oriundos de fundos públicos são salvos no banco de
dados. As propriedades são: Código da receita, Nome do doador, CNPJ do
doador, Valor, Tipo do fundo (Fundo Partidário ou Fundo Especial),
Candidato favorecido, Descrição, Recibo eleitoral e Data.

## Qual a diferença entre o 72 horas e a plataforma Divulgacand?

Consumimos os dados do TSE e facilitamos a visualização de recortes por
gênero, etnia, fundo, partido, cidade e estado. Além da visualização
amigável e considerando conceitos de usabilidade no frontend da
plataforma, agrupamos informações coletadas na API para o abastecimento de
notificações no protocolo RSS, integrado a diversas redes sociais.

## A plataforma 72 horas pode apresentar alguma margem de erro nos recortes?

Sim, pois dependemos da declaração dos prestadores de contas/candidaturas e
da atualização do sistema do TSE.

## Podem haver oscilações para mais ou menos nos valores apresentados pela plataforma 72 horas?

Sim, pois dependemos da prestação de contas de centenas de milhares de
candidaturas e acompanhamos as atualizações de acordo com o banco de dados
do TSE. Por isso, quando acontecem correções ou atualizações de
informações desses prestadores no sistema SPCE que informa ao TSE todos os
valores, automaticamente todas essas informações são atualizadas na
visualização da plataforma 72 horas.
